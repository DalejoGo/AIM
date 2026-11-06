import { type Llm, LlmError, type LlmEvent, type LlmRequest, type LlmUsage } from '../deps'

/** Free default model of the Lab assistant on Cloudflare Workers AI (DEC-018). */
export const WORKERS_AI_DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it'

/** The part of the Workers AI binding (`env.AI`) the assistant uses. */
export interface WorkersAi {
  run(model: string, input: Record<string, unknown>): Promise<unknown>
}

/**
 * A model on Cloudflare Workers AI through the `AI` binding: no API key, billed in "neurons" with a free daily
 * allocation (DEC-018). The stream is server-sent events; both the classic `{ response }` chunks and the
 * OpenAI-style `{ choices: [{ delta }] }` chunks are understood. Reasoning text never reaches the visitor.
 */
export function workersAiLlm(ai: WorkersAi): Llm {
  return {
    async *stream(request: LlmRequest): AsyncGenerator<LlmEvent> {
      let body: unknown
      try {
        body = await ai.run(request.model, {
          messages: [{ role: 'system', content: request.system }, ...request.messages],
          stream: true,
          max_completion_tokens: request.maxTokens,
          stream_options: { include_usage: true },
          // Short answers from a given text: no hidden reasoning to wait for or pay for.
          chat_template_kwargs: { enable_thinking: false },
        })
      } catch (err) {
        throw toLlmError(err)
      }
      if (!(body instanceof ReadableStream)) throw new LlmError('Workers AI answered without a stream', false)

      const reader = (body as ReadableStream<Uint8Array>).getReader()
      // The visitor left: stop reading so the model stops generating.
      const onAbort = () => void reader.cancel().catch(() => {})
      request.signal?.addEventListener('abort', onAbort, { once: true })

      let stopReason = 'end_turn'
      const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
      try {
        for await (const data of sseData(reader)) {
          if (data === '[DONE]') break
          const chunk = parseChunk(data)
          if (!chunk) continue
          if (chunk.error) throw toLlmError(new Error(chunk.error))
          if (chunk.text) yield { type: 'text', text: chunk.text }
          if (chunk.finishReason) stopReason = mapStopReason(chunk.finishReason)
          if (chunk.usage) {
            usage.inputTokens = chunk.usage.input
            usage.outputTokens = chunk.usage.output
          }
        }
        yield { type: 'done', stopReason, usage }
      } catch (err) {
        throw toLlmError(err)
      } finally {
        request.signal?.removeEventListener('abort', onAbort)
        reader.releaseLock()
      }
    },
  }
}

interface Chunk {
  text?: string
  finishReason?: string
  usage?: { input: number; output: number }
  error?: string
}

/** One SSE `data:` payload of Workers AI, in either of its two shapes. */
export function parseChunk(data: string): Chunk | null {
  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    return null
  }
  if (!json || typeof json !== 'object') return null
  const raw = json as {
    response?: unknown
    choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[]
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
    errors?: { message?: unknown }[]
    error?: unknown
  }
  const chunk: Chunk = {}
  const choice = raw.choices?.[0]
  const text = typeof raw.response === 'string' ? raw.response : choice?.delta?.content
  if (typeof text === 'string' && text.length > 0) chunk.text = text
  if (typeof choice?.finish_reason === 'string') chunk.finishReason = choice.finish_reason
  if (
    raw.usage &&
    typeof raw.usage.prompt_tokens === 'number' &&
    typeof raw.usage.completion_tokens === 'number'
  ) {
    chunk.usage = { input: raw.usage.prompt_tokens, output: raw.usage.completion_tokens }
  }
  const error = typeof raw.error === 'string' ? raw.error : raw.errors?.[0]?.message
  if (typeof error === 'string') chunk.error = error
  return chunk
}

/** Yields the `data:` payloads of a server-sent event stream, whatever the chunk boundaries. */
export async function* sseData(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      if (line.startsWith('data:')) yield line.slice(5).trimStart()
      newline = buffer.indexOf('\n')
    }
    if (done) {
      if (buffer.startsWith('data:')) yield buffer.slice(5).trimStart()
      return
    }
  }
}

function mapStopReason(reason: string): string {
  if (reason === 'stop') return 'end_turn'
  if (reason === 'length') return 'max_tokens'
  return reason
}

// 3040: out of capacity; 4006: the free daily allocation is used up; 429: too many requests.
const BUSY = /\b(3040|4006|429)\b|capacity|daily free allocation|rate limit/i

function toLlmError(err: unknown): unknown {
  if (err instanceof LlmError) return err
  if (err instanceof Error && err.name === 'AbortError') return err
  const message = err instanceof Error ? err.message : String(err)
  return new LlmError(message, BUSY.test(message))
}
