import Anthropic from '@anthropic-ai/sdk'
import { type Llm, LlmError, type LlmEvent, type LlmRequest, type LlmUsage } from '../deps'

/**
 * Claude through the official SDK (it uses fetch, so it runs in Workers). The client is built on the first
 * message of a request, so other routes pay nothing for it. Only text deltas reach the visitor, thinking does not.
 */
export function anthropicLlm(options: { apiKey: string; fetch?: typeof fetch }): Llm {
  let client: Anthropic | undefined
  const getClient = () => {
    client ??= new Anthropic({
      apiKey: options.apiKey,
      // A visitor is waiting: one quick retry on 429/5xx before the first byte, then the error is shown.
      maxRetries: 1,
      timeout: 30_000,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    })
    return client
  }

  return {
    async *stream(request: LlmRequest): AsyncGenerator<LlmEvent> {
      const stream = getClient().messages.stream(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          // Same bytes for every visitor and every turn, so it is cached once and read at a tenth of the price.
          system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          // Short answers from a given text: low effort keeps thinking (and its tokens) to a minimum.
          output_config: { effort: 'low' },
        },
        request.signal ? { signal: request.signal } : undefined,
      )
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield { type: 'text', text: event.delta.text }
          }
        }
        const message = await stream.finalMessage()
        yield { type: 'done', stopReason: message.stop_reason ?? 'end_turn', usage: usageOf(message.usage) }
      } catch (err) {
        throw toLlmError(err)
      } finally {
        // The visitor left or the consumer stopped early: stop paying for tokens nobody reads.
        if (!stream.ended) stream.abort()
      }
    },
  }
}

function usageOf(usage: Anthropic.Usage): LlmUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  }
}

const BUSY_TYPES = new Set(['rate_limit_error', 'overloaded_error'])

function toLlmError(err: unknown): unknown {
  if (err instanceof Anthropic.APIUserAbortError) return err
  if (err instanceof Anthropic.RateLimitError) return new LlmError(err.message, true)
  if (err instanceof Anthropic.APIError) {
    const busy = err.status === 529 || (err.type !== null && BUSY_TYPES.has(err.type))
    return new LlmError(err.message, busy)
  }
  return err
}

export interface ScriptedReply {
  /** Text chunks, sent in order. */
  text?: string[]
  stopReason?: string
  usage?: Partial<LlmUsage>
  /** Thrown after the text chunks, instead of finishing. */
  error?: Error
}

/** Deterministic model for tests: plays the same reply and records every request. */
export function scriptedLlm(reply: ScriptedReply = {}): Llm & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = []
  return {
    requests,
    async *stream(request) {
      requests.push(request)
      for (const text of reply.text ?? ['Hola, soy el asistente de AIM.']) yield { type: 'text', text }
      if (reply.error) throw reply.error
      yield {
        type: 'done',
        stopReason: reply.stopReason ?? 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ...reply.usage },
      }
    },
  }
}
