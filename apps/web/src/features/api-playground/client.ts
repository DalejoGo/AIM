import type { PreparedRequest } from './request'
import { type HeaderLine, pickHeaders } from './response'
import { REQUEST_TIMEOUT_MS } from './wake'

/** What came of a request: an answer (any status), no answer in time, or no connection at all. */
export type Outcome =
  | { kind: 'response'; status: number; headers: HeaderLine[]; body: string; totalMs: number }
  | { kind: 'timeout'; totalMs: number }
  | { kind: 'network'; totalMs: number }

export type Fetch = (input: string, init: RequestInit) => Promise<Response>

export interface SendOptions {
  /** Aborted by the visitor ("Cancelar"): the result is then `null`. */
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: Fetch
  /** Monotonic clock in ms (performance.now in the browser). */
  clock?: () => number
}

/**
 * Sends the request to the API (another origin, CORS) and reads the whole answer. The total time is measured
 * here, from just before the call until the body has arrived. No cookies travel, and the browser cache is
 * skipped so every answer is a fresh one with its own timings and rate-limit headers.
 */
export async function sendRequest(
  request: PreparedRequest,
  {
    signal,
    timeoutMs = REQUEST_TIMEOUT_MS,
    fetchImpl = (input, init) => fetch(input, init),
    clock = () => performance.now(),
  }: SendOptions = {},
): Promise<Outcome | null> {
  if (signal?.aborted) return null
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })

  const started = clock()
  const elapsed = () => Math.max(0, Math.round(clock() - started))
  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body ?? undefined,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
    })
    const body = await response.text()
    return {
      kind: 'response',
      status: response.status,
      headers: pickHeaders(response.headers),
      body,
      totalMs: elapsed(),
    }
  } catch {
    if (timedOut) return { kind: 'timeout', totalMs: elapsed() }
    if (signal?.aborted) return null
    return { kind: 'network', totalMs: elapsed() }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
