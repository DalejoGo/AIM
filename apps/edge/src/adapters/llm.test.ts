import { describe, expect, it } from 'vitest'
import { LlmError, type LlmEvent, type LlmRequest } from '../deps'
import { anthropicLlm } from './llm'

// The real SDK against a fake fetch: checks the request Claude receives and how its stream is read, without network.

const request: LlmRequest = {
  model: 'claude-haiku-5-5',
  system: 'Reglas y conocimiento',
  messages: [{ role: 'user', content: '¿Cuánto cuesta una página web?' }],
  maxTokens: 500,
}

function sse(events: [string, unknown][]): string {
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')
}

const ANSWER = sse([
  [
    'message_start',
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 21,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 4800,
        },
      },
    },
  ],
  [
    'content_block_start',
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '', signature: '' },
    },
  ],
  [
    'content_block_delta',
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } },
  ],
  [
    'content_block_delta',
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 's' } },
  ],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  [
    'content_block_start',
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  ],
  [
    'content_block_delta',
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Desde ' } },
  ],
  [
    'content_block_delta',
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'COP 900.000.' } },
  ],
  ['content_block_stop', { type: 'content_block_stop', index: 1 }],
  [
    'message_delta',
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 42 },
    },
  ],
  ['message_stop', { type: 'message_stop' }],
])

function fakeFetch(respond: () => Response) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    return respond()
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

const streamResponse = (body: string) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })

async function collect(events: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = []
  for await (const event of events) out.push(event)
  return out
}

describe('anthropicLlm', () => {
  it('streams only the text and ends with the stop reason and the real usage', async () => {
    const { fetch } = fakeFetch(() => streamResponse(ANSWER))
    const events = await collect(anthropicLlm({ apiKey: 'sk-test', fetch }).stream(request))

    expect(events).toEqual([
      { type: 'text', text: 'Desde ' },
      { type: 'text', text: 'COP 900.000.' },
      {
        type: 'done',
        stopReason: 'end_turn',
        usage: { inputTokens: 21, outputTokens: 42, cacheReadTokens: 4800, cacheWriteTokens: 0 },
      },
    ])
  })

  it('sends a streamed request with the cached system prompt, low effort and no sampling parameters', async () => {
    const { fetch, calls } = fakeFetch(() => streamResponse(ANSWER))
    await collect(anthropicLlm({ apiKey: 'sk-test', fetch }).stream(request))

    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toMatch(/\/v1\/messages$/)
    // The SDK decides the auth header (x-api-key or Bearer, by API version); the key must travel in it.
    expect(call?.headers.get('x-api-key') ?? call?.headers.get('authorization')).toContain('sk-test')
    expect(call?.body).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 500,
      stream: true,
      system: [{ type: 'text', text: 'Reglas y conocimiento', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: '¿Cuánto cuesta una página web?' }],
      output_config: { effort: 'low' },
    })
  })

  it.each([
    [529, 'overloaded_error', true],
    [429, 'rate_limit_error', true],
    [400, 'invalid_request_error', false],
    [401, 'authentication_error', false],
  ])('turns an HTTP %i into an LlmError (busy: %s)', async (status, type, busy) => {
    const { fetch } = fakeFetch(
      () =>
        new Response(JSON.stringify({ type: 'error', error: { type, message: 'nope' } }), {
          status,
          headers: { 'content-type': 'application/json', 'x-should-retry': 'false' },
        }),
    )
    const error = await collect(anthropicLlm({ apiKey: 'sk-test', fetch }).stream(request)).catch((e) => e)

    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).busy).toBe(busy)
  })

  it('turns an error event in the middle of the stream into a busy LlmError', async () => {
    const midStream =
      ANSWER.slice(
        0,
        ANSWER.indexOf('event: content_block_stop\ndata: {"type":"content_block_stop","index":1'),
      ) + sse([['error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]])
    const { fetch } = fakeFetch(() => streamResponse(midStream))

    const seen: LlmEvent[] = []
    const error = await (async () => {
      for await (const event of anthropicLlm({ apiKey: 'sk-test', fetch }).stream(request)) seen.push(event)
    })().catch((e) => e)

    expect(seen.map((e) => e.type)).toEqual(['text', 'text'])
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).busy).toBe(true)
  })
})
