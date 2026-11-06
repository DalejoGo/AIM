import { describe, expect, it } from 'vitest'
import type { LlmEvent } from '../deps'
import { LlmError } from '../deps'
import { parseChunk, sseData, type WorkersAi, workersAiLlm } from './workers-ai'

const encoder = new TextEncoder()

/** A stream that delivers `text` in pieces of `size` bytes, to cut SSE lines anywhere. */
function streamOf(text: string, size = 7): ReadableStream<Uint8Array> {
  const bytes = encoder.encode(text)
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close()
      controller.enqueue(bytes.slice(offset, offset + size))
      offset += size
    },
  })
}

function fakeAi(
  body: string | Error,
  calls: { model: string; input: Record<string, unknown> }[] = [],
): WorkersAi {
  return {
    async run(model, input) {
      calls.push({ model, input })
      if (body instanceof Error) throw body
      return streamOf(body)
    },
  }
}

async function collect(events: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = []
  for await (const event of events) out.push(event)
  return out
}

const request = {
  model: '@cf/google/gemma-4-26b-a4b-it',
  system: 'Eres el asistente.',
  messages: [{ role: 'user' as const, content: '¿Cuánto cuesta una web?' }],
  maxTokens: 400,
}

describe('workersAiLlm', () => {
  it('streams OpenAI-style chunks, skips reasoning and reports usage', async () => {
    const body = [
      'data: {"choices":[{"delta":{"reasoning_content":"pensando…"}}]}',
      'data: {"choices":[{"delta":{"content":"Desde "}}]}',
      'data: {"choices":[{"delta":{"content":"$ 900.000."},"finish_reason":"stop"}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":5200,"completion_tokens":12}}',
      'data: [DONE]',
      '',
    ].join('\n\n')
    const calls: { model: string; input: Record<string, unknown> }[] = []
    const events = await collect(workersAiLlm(fakeAi(body, calls)).stream(request))

    expect(events).toEqual([
      { type: 'text', text: 'Desde ' },
      { type: 'text', text: '$ 900.000.' },
      {
        type: 'done',
        stopReason: 'end_turn',
        usage: { inputTokens: 5200, outputTokens: 12, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    ])
    expect(calls[0]?.model).toBe('@cf/google/gemma-4-26b-a4b-it')
    expect(calls[0]?.input).toMatchObject({
      stream: true,
      max_completion_tokens: 400,
      messages: [
        { role: 'system', content: 'Eres el asistente.' },
        { role: 'user', content: '¿Cuánto cuesta una web?' },
      ],
    })
  })

  it('understands the classic { response } chunks and a length stop', async () => {
    const body =
      'data: {"response":"Hola"}\r\n\r\ndata: {"response":"","choices":[{"finish_reason":"length"}]}\n\n'
    const events = await collect(workersAiLlm(fakeAi(body)).stream(request))
    expect(events[0]).toEqual({ type: 'text', text: 'Hola' })
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'max_tokens' })
  })

  it('marks quota and capacity errors as busy', async () => {
    const quota = new Error('4006: you have used up your daily free allocation of 10,000 neurons')
    await expect(collect(workersAiLlm(fakeAi(quota)).stream(request))).rejects.toMatchObject({
      name: 'LlmError',
      busy: true,
    })
    const other = new Error('5007: model not found')
    const error = await collect(workersAiLlm(fakeAi(other)).stream(request)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).busy).toBe(false)
  })

  it('turns an error inside the stream into an LlmError', async () => {
    const body = 'data: {"response":"Ho"}\n\ndata: {"error":"3040: out of capacity"}\n\n'
    await expect(collect(workersAiLlm(fakeAi(body)).stream(request))).rejects.toMatchObject({ busy: true })
  })
})

describe('sseData and parseChunk', () => {
  it('yields every data line whatever the chunk boundaries', async () => {
    const lines: string[] = []
    for await (const data of sseData(streamOf('data: a\n\n: comment\ndata: b\n\ndata: c', 1).getReader())) {
      lines.push(data)
    }
    expect(lines).toEqual(['a', 'b', 'c'])
  })

  it('ignores payloads that are not JSON objects', () => {
    expect(parseChunk('not json')).toBeNull()
    expect(parseChunk('42')).toBeNull()
  })
})
