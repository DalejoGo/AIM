import {
  MigrationResponse,
  PYLAB_FILE_FIELD,
  PYLAB_HEALTH_PATH,
  PYLAB_MIGRATIONS_PATH,
  PYLAB_SHEET_FIELD,
  PyLabError,
  PyLabHealth,
} from '@aim/contracts/migrator'
import { HEALTH_TIMEOUT_MS, SERVER_TIMEOUT_MS } from './server'

/**
 * Talks to the Python engine (another origin, CORS, no cookies). Every answer is checked against the shared
 * contract before the page uses it. Loaded on demand: it brings Zod and the contract schemas.
 */

export type Fetch = (input: string, init: RequestInit) => Promise<Response>

export interface CallOptions {
  /** Aborted by the visitor ("Cancelar"): the result is then `null`. */
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: Fetch
  /** Monotonic clock in ms (performance.now in the browser). */
  clock?: () => number
}

export type ServerOutcome<T> =
  | { kind: 'ok'; data: T; totalMs: number }
  /** A non-2xx answer with the API's error body (or a generic one when the body is something else). */
  | { kind: 'error'; status: number; error: PyLabError; retryAfter: number | null; totalMs: number }
  | { kind: 'timeout' | 'network' | 'invalid'; totalMs: number }

const UNKNOWN_ERROR: PyLabError = {
  error: 'unknown',
  message: 'El servidor no pudo procesar el archivo. Vuelve a intentarlo en un momento.',
}

async function call<T>(
  url: string,
  init: RequestInit,
  parse: (body: unknown) => T | null,
  {
    signal,
    timeoutMs = SERVER_TIMEOUT_MS,
    fetchImpl = (u, i) => fetch(u, i),
    clock = () => performance.now(),
  }: CallOptions,
): Promise<ServerOutcome<T> | null> {
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
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
    })
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = undefined
    }
    if (!response.ok) {
      const parsed = PyLabError.safeParse(body)
      const retry = Number(response.headers.get('Retry-After'))
      return {
        kind: 'error',
        status: response.status,
        error: parsed.success ? parsed.data : UNKNOWN_ERROR,
        retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
        totalMs: elapsed(),
      }
    }
    const data = parse(body)
    return data === null ? { kind: 'invalid', totalMs: elapsed() } : { kind: 'ok', data, totalMs: elapsed() }
  } catch {
    if (timedOut) return { kind: 'timeout', totalMs: elapsed() }
    if (signal?.aborted) return null
    return { kind: 'network', totalMs: elapsed() }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

/** GET /health: wakes the server up and tells its limits. */
export function fetchHealth(apiUrl: string, options: CallOptions = {}) {
  return call(
    `${apiUrl}${PYLAB_HEALTH_PATH}`,
    { method: 'GET' },
    (body) => {
      const parsed = PyLabHealth.safeParse(body)
      return parsed.success ? parsed.data : null
    },
    { timeoutMs: HEALTH_TIMEOUT_MS, ...options },
  )
}

/** POST /v1/migrations with the file (and the sheet of a workbook). The browser sets the multipart boundary. */
export function postMigration(apiUrl: string, file: File, sheet: string | null, options: CallOptions = {}) {
  const form = new FormData()
  form.append(PYLAB_FILE_FIELD, file, file.name)
  if (sheet) form.append(PYLAB_SHEET_FIELD, sheet)
  return call(
    `${apiUrl}${PYLAB_MIGRATIONS_PATH}`,
    { method: 'POST', body: form },
    (body) => {
      const parsed = MigrationResponse.safeParse(body)
      return parsed.success ? parsed.data : null
    },
    options,
  )
}
