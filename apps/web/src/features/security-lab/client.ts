import { ApiRequestError, type Fetch, messageForStatus, toApiError } from '../../lib/api'
import { type BurstHit, hitKind } from './burst'
import { rateLimitLines, readRateLimit } from './rateLimit'

/**
 * Client of GET /api/lab/burst (apps/edge/src/routes/lab.ts). The island imports it only when the burst
 * starts, so lib/api and its schemas stay out of the page's first load.
 */

export const BURST_PATH = '/api/lab/burst'

export interface BurstOptions {
  count: number
  /** Called as soon as each answer is read, so the timeline grows while the burst runs. */
  onHit: (hit: BurstHit) => void
  signal?: AbortSignal
  fetchImpl?: Fetch
  /** Monotonic clock in ms (performance.now in the browser). */
  clock?: () => number
}

export interface BurstRun {
  hits: BurstHit[]
  /** Why the burst stopped early: no connection, a server error or an unexpected answer. A 429 is not one. */
  error: ApiRequestError | null
}

const invalidResponse = (status: number) =>
  new ApiRequestError({
    status,
    code: 'invalid_response',
    message: 'La API respondió algo que esta demo no esperaba. Recarga la página e inténtalo de nuevo.',
  })

/** The 200 body (LabBurstResult in @aim/contracts): { ok: true, remaining, resetInSeconds }. */
function remainingFromBody(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null
  const { ok, remaining } = body as Record<string, unknown>
  return ok === true && typeof remaining === 'number' && Number.isInteger(remaining) ? remaining : null
}

/**
 * Sends `count` requests one after the other (each waits for the previous answer, like a script would) and
 * stops at the first answer that is neither 2xx nor 429. Aborting stops it quietly.
 */
export async function runBurst({
  count,
  onHit,
  signal,
  fetchImpl = (input, init) => fetch(input, init),
  clock = () => performance.now(),
}: BurstOptions): Promise<BurstRun> {
  const hits: BurstHit[] = []
  const record = (hit: BurstHit) => {
    hits.push(hit)
    onHit(hit)
  }

  for (let n = 1; n <= count && !signal?.aborted; n++) {
    const started = clock()
    let response: Response
    try {
      response = await fetchImpl(BURST_PATH, {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      })
    } catch {
      if (signal?.aborted) break
      const error = new ApiRequestError({ status: 0, code: 'network_error', message: messageForStatus(0) })
      record({
        n,
        status: 0,
        ms: Math.round(clock() - started),
        remaining: null,
        retryAfter: null,
        headers: [],
      })
      return { hits, error }
    }

    const limits = readRateLimit(response.headers)
    const kind = hitKind(response.status)
    let error: ApiRequestError | null = null
    let remaining = limits.remaining
    if (kind === 'passed') {
      const fromBody = remainingFromBody(await response.json().catch(() => null))
      if (fromBody === null) error = invalidResponse(response.status)
      remaining ??= fromBody
    } else {
      error = await toApiError(response)
    }
    if (signal?.aborted) break

    record({
      n,
      status: response.status,
      ms: Math.round(clock() - started),
      remaining: kind === 'blocked' ? (remaining ?? 0) : remaining,
      retryAfter: kind === 'blocked' ? (error?.retryAfter ?? limits.retryAfter) : null,
      headers: rateLimitLines(response.headers),
    })
    if (kind !== 'blocked' && error) return { hits, error }
  }
  return { hits, error: null }
}
