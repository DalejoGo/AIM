import {
  ApiError,
  AuditPage,
  CodeSent,
  EMAIL_OTP_GRANT,
  Lead,
  LeadCreated,
  LeadPage,
  type LeadStatus,
  type LeadSubmission,
  Principal,
  type RequestCode,
  type TokenRequest,
  TokenResponse,
  type UpdateLeadStatus,
} from '@aim/contracts'
import type { z } from 'zod'

/**
 * Client for the edge API (DEC-014): same origin, JSON, cookies only (the tokens are HttpOnly, DEC-017).
 * Every response is checked against @aim/contracts. Islands that only need it on submit import it lazily,
 * so zod stays out of their first load.
 */

export type FieldErrors = Record<string, string[]>

interface ApiRequestErrorInit {
  status: number
  code: string
  message: string
  fields?: FieldErrors
  retryAfter?: number | null
}

/** A failed call, ready to show: `message` is Spanish and says what to do next. */
export class ApiRequestError extends Error {
  /** HTTP status, or 0 when no response arrived. */
  readonly status: number
  /** `error` of the ApiError body, or a client code: network_error, invalid_response, session_expired. */
  readonly code: string
  readonly fields: FieldErrors
  /** Seconds from the Retry-After header, when present. */
  readonly retryAfter: number | null

  constructor({ status, code, message, fields = {}, retryAfter = null }: ApiRequestErrorInit) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.fields = fields
    this.retryAfter = retryAfter
  }
}

export const SESSION_EXPIRED = 'session_expired'

/** The admin session is over (the refresh failed): the panel goes back to the login. */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === SESSION_EXPIRED
}

const sessionExpired = () =>
  new ApiRequestError({
    status: 401,
    code: SESSION_EXPIRED,
    message: 'Tu sesión terminó. Vuelve a entrar con tu correo.',
  })

/** Used when the body is not an ApiError (proxy page, network failure, old deploy). */
export function messageForStatus(status: number, retryAfter: number | null = null): string {
  if (status === 0) return 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'
  if (status === 401) return 'Tu sesión terminó. Vuelve a entrar con tu correo.'
  if (status === 403) return 'Tu cuenta no tiene permiso para hacer esto.'
  if (status === 429) {
    const minutes = retryAfter ? Math.max(1, Math.ceil(retryAfter / 60)) : null
    return minutes
      ? `Hiciste demasiados intentos. Espera ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} e inténtalo de nuevo.`
      : 'Hiciste demasiados intentos. Espera unos minutos e inténtalo de nuevo.'
  }
  if (status >= 500) return 'El servidor no pudo responder. Inténtalo de nuevo en unos minutos.'
  return 'No se pudo completar la solicitud. Recarga la página e inténtalo de nuevo.'
}

/** Retry-After as seconds: either delta-seconds or an HTTP date (RFC 9110 §10.2.3). */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value?.trim()) return null
  if (/^\d+$/.test(value.trim())) return Number(value.trim())
  const at = Date.parse(value)
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000))
}

/** Turns a non-2xx response into an ApiRequestError, keeping the server's message when the body is valid. */
export async function toApiError(response: Response): Promise<ApiRequestError> {
  const retryAfter = parseRetryAfter(response.headers.get('Retry-After'))
  const body: unknown = await response.json().catch(() => null)
  const parsed = ApiError.safeParse(body)
  if (!parsed.success) {
    return new ApiRequestError({
      status: response.status,
      code: `http_${response.status}`,
      message: messageForStatus(response.status, retryAfter),
      retryAfter,
    })
  }
  return new ApiRequestError({
    status: response.status,
    code: parsed.data.error,
    message: parsed.data.message,
    fields: parsed.data.fields ?? {},
    retryAfter,
  })
}

export type Fetch = (input: string, init: RequestInit) => Promise<Response>

type Method = 'GET' | 'POST' | 'PATCH'

interface CallOptions<T> {
  method?: Method
  body?: unknown
  /** Schema of the 2xx body; `null` when no body is expected (204). */
  schema: z.ZodType<T> | null
}

export interface LeadQuery {
  status?: LeadStatus
  cursor?: string
  limit?: number
}

function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

/** The part of the Web Locks API the client uses (navigator.locks). */
export interface Locks {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>
}

/** Name of the lock every tab of the site takes before renewing the session. */
export const REFRESH_LOCK = 'aim-refresh'

/** navigator.locks when the browser has it (all current ones in secure contexts), else null. */
function browserLocks(): Locks | null {
  if (typeof navigator === 'undefined' || !navigator.locks) return null
  const manager = navigator.locks
  // The DOM typing nests the callback promise; awaiting it flattens the type as the runtime already does.
  return { request: async (name, callback) => await manager.request(name, () => callback()) }
}

interface ApiOptions {
  /** Cross-tab lock. Undefined: navigator.locks when available. Null: single-tab behaviour. */
  locks?: Locks | null
}

/** Builds the client. `fetchImpl` and `locks` are injectable so the retry logic is tested without a browser. */
export function createApi(
  fetchImpl: Fetch = (input, init) => fetch(input, init),
  { locks }: ApiOptions = {},
) {
  async function send(path: string, method: Method, body: unknown): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    try {
      return await fetchImpl(path, {
        method,
        headers,
        credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new ApiRequestError({ status: 0, code: 'network_error', message: messageForStatus(0) })
    }
  }

  async function read<T>(response: Response, schema: z.ZodType<T> | null): Promise<T> {
    if (!response.ok) throw await toApiError(response)
    if (schema === null) return undefined as T
    const parsed = schema.safeParse(await response.json().catch(() => undefined))
    if (parsed.success) return parsed.data
    throw new ApiRequestError({
      status: response.status,
      code: 'invalid_response',
      message:
        'La respuesta del servidor no tiene el formato esperado. Recarga la página e inténtalo de nuevo.',
    })
  }

  async function call<T>(path: string, { method = 'GET', body, schema }: CallOptions<T>): Promise<T> {
    return read(await send(path, method, body), schema)
  }

  // The refresh token rotates on every use and the API treats a second renewal with the same cookie as
  // reuse, revoking the whole session (DEC-017). So renewals are single flight: one shared promise in
  // this tab, and the Web Locks API across tabs.
  let renewing: Promise<ApiRequestError | null> | null = null

  /** POST /api/auth/token with the refresh grant. Resolves to the error, or null when renewed. */
  function renew(): Promise<ApiRequestError | null> {
    const body: TokenRequest = { grant_type: 'refresh_token' }
    renewing ??= send('/api/auth/token', 'POST', body)
      .then((response) => (response.ok ? null : toApiError(response)))
      .catch((error: unknown) =>
        error instanceof ApiRequestError
          ? error
          : new ApiRequestError({ status: 0, code: 'network_error', message: messageForStatus(0) }),
      )
      .finally(() => {
        renewing = null
      })
    return renewing
  }

  /** A failed renewal: no connection or a server error keeps the session; anything else ends it. */
  const renewalError = (failure: ApiRequestError) =>
    failure.status === 0 || failure.status >= 500 ? failure : sessionExpired()

  /**
   * After a 401: renews the session and repeats the request once. Inside the cross-tab lock the request is
   * first repeated as is, because another tab may have renewed the cookies while this one waited.
   */
  async function recover(repeat: () => Promise<Response>): Promise<Response> {
    const lockManager = locks === undefined ? browserLocks() : locks
    if (!lockManager) {
      const failure = await renew()
      if (failure) throw renewalError(failure)
      return repeat()
    }
    return lockManager.request(REFRESH_LOCK, async () => {
      const again = await repeat()
      if (again.status !== 401) return again
      const failure = await renew()
      if (failure) throw renewalError(failure)
      return repeat()
    })
  }

  /** Admin calls: on 401, one renewal and one retry. If the renewal is refused, the session is over. */
  async function authorized<T>(path: string, { method = 'GET', body, schema }: CallOptions<T>): Promise<T> {
    const first = await send(path, method, body)
    if (first.status !== 401) return read(first, schema)
    const response = await recover(() => send(path, method, body))
    if (response.status === 401) throw sessionExpired()
    return read(response, schema)
  }

  return {
    /** POST /api/leads */
    submitLead: (lead: LeadSubmission) =>
      call('/api/leads', { method: 'POST', body: lead, schema: LeadCreated }),
    /** POST /api/auth/code: always the same answer, whether or not the address has access. */
    requestCode: (request: RequestCode) =>
      call('/api/auth/code', { method: 'POST', body: request, schema: CodeSent }),
    /** POST /api/auth/token with the e-mail code grant; the tokens arrive as HttpOnly cookies. */
    signIn: (email: string, code: string) => {
      const body: TokenRequest = { grant_type: EMAIL_OTP_GRANT, email, code }
      return call('/api/auth/token', { method: 'POST', body, schema: TokenResponse })
    },
    /** POST /api/auth/revoke */
    signOut: () => call('/api/auth/revoke', { method: 'POST', schema: null }),
    /** GET /api/auth/me, renewing the session first if the access token expired. */
    me: () => authorized('/api/auth/me', { schema: Principal }),
    listLeads: (query: LeadQuery = {}) =>
      authorized(withQuery('/api/admin/leads', { ...query }), { schema: LeadPage }),
    updateLeadStatus: (id: string, status: LeadStatus) => {
      const body: UpdateLeadStatus = { status }
      return authorized(`/api/admin/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body, schema: Lead })
    },
    listAudit: (cursor?: string) =>
      authorized(withQuery('/api/admin/audit', { cursor }), { schema: AuditPage }),
  }
}

export type Api = ReturnType<typeof createApi>

/** The browser client. */
export const api = createApi()
