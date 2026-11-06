import { ApiRequestError, type Fetch, messageForStatus, toApiError } from '../../lib/api'
import { AssistantStreamError, CONNECTION_LOST, INVALID_STREAM, STREAM_INTERRUPTED } from './errors'
import type { Turn } from './history'
import { readSseEvents } from './sse'

/**
 * Client for /api/assistant (apps/edge/src/routes/assistant.ts). Same origin; the session is an HttpOnly
 * cookie the browser sends by itself. Errors before the stream are ApiRequestError (lib/api); errors inside
 * it are AssistantStreamError.
 */

export interface AnswerOptions {
  signal: AbortSignal
  /** Each piece of text as it arrives. */
  onDelta: (text: string) => void
}

export interface AnswerResult {
  /** The model's stop reason: end_turn, max_tokens… */
  reason: string
}

export interface AssistantClient {
  /** POST /api/assistant/session: spends the Turnstile token and sets the 30-minute session cookie. */
  startSession(turnstileToken: string): Promise<void>
  /** POST /api/assistant/messages: streams the answer and resolves when `done` arrives. */
  answer(messages: Turn[], options: AnswerOptions): Promise<AnswerResult>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseData(data: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(data)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

const invalidStream = () => new AssistantStreamError(INVALID_STREAM, 'The answer stream is not valid')

export function createAssistantClient(
  fetchImpl: Fetch = (input, init) => fetch(input, init),
): AssistantClient {
  async function post(path: string, body: unknown, accept: string, signal?: AbortSignal): Promise<Response> {
    let response: Response
    try {
      response = await fetchImpl(path, {
        method: 'POST',
        headers: { accept, 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new ApiRequestError({ status: 0, code: 'network_error', message: messageForStatus(0) })
    }
    if (!response.ok) throw await toApiError(response)
    return response
  }

  return {
    async startSession(turnstileToken) {
      await post('/api/assistant/session', { turnstileToken }, 'application/json')
    },

    async answer(messages, { signal, onDelta }) {
      const response = await post('/api/assistant/messages', { messages }, 'text/event-stream', signal)
      const type = response.headers.get('content-type') ?? ''
      if (!type.includes('text/event-stream') || !response.body) {
        await response.body?.cancel().catch(() => {})
        throw invalidStream()
      }
      try {
        for await (const event of readSseEvents(response.body)) {
          if (event.event === 'delta') {
            const text = parseData(event.data)?.text
            if (typeof text !== 'string') throw invalidStream()
            onDelta(text)
          } else if (event.event === 'done') {
            const reason = parseData(event.data)?.reason
            return { reason: typeof reason === 'string' ? reason : 'end_turn' }
          } else if (event.event === 'error') {
            const data = parseData(event.data)
            const code = typeof data?.error === 'string' ? data.error : 'assistant_failed'
            const message = typeof data?.message === 'string' ? data.message : ''
            throw new AssistantStreamError(code, message)
          }
          // Other events (none today) are ignored, so the API can add some without breaking old pages.
        }
      } catch (error) {
        if (error instanceof AssistantStreamError || signal.aborted) throw error
        throw new AssistantStreamError(CONNECTION_LOST, 'The connection dropped during the answer')
      }
      throw new AssistantStreamError(STREAM_INTERRUPTED, 'The answer stream ended without done')
    },
  }
}

/** The browser client. */
export const assistantClient = createAssistantClient()
