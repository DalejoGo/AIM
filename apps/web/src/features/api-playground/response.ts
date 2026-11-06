import type { ApiError } from '@aim/contracts'

/**
 * Reading an answer of the API: the headers worth showing, the timings, the rate limit, the body as indented
 * JSON and, for errors, what happened in plain Spanish.
 */

export interface HeaderLine {
  name: string
  value: string
}

/**
 * Headers the console shows, in this order. From another origin the browser only lets JavaScript read
 * Content-Type and the ones the API lists in Access-Control-Expose-Headers (apps/api/src/app.ts).
 */
export const SHOWN_HEADERS = [
  'content-type',
  'x-response-time',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'retry-after',
  'location',
] as const

/** The shown headers that arrived, with their values untouched. */
export function pickHeaders(headers: Pick<Headers, 'get'>): HeaderLine[] {
  return SHOWN_HEADERS.flatMap((name) => {
    const value = headers.get(name)
    return value === null ? [] : [{ name, value }]
  })
}

export function headerValue(lines: readonly HeaderLine[], name: string): string | null {
  const wanted = name.toLowerCase()
  return lines.find((line) => line.name.toLowerCase() === wanted)?.value ?? null
}

/** A non-negative integer; anything else (empty, negative, decimals, text) counts as absent. */
export function parseCount(value: string | null): number | null {
  const text = value?.trim()
  return text && /^\d+$/.test(text) ? Number(text) : null
}

/** X-Response-Time as milliseconds: the API sends `12.3ms`; a bare number is read as ms too. */
export function parseServerTime(value: string | null): number | null {
  const match = value ? /^\s*(\d+(?:\.\d+)?)\s*(ms)?\s*$/i.exec(value) : null
  return match ? Number(match[1]) : null
}

/**
 * Retry-After as seconds: delta-seconds or an HTTP date (RFC 9110 §10.2.3). Kept here instead of importing
 * lib/api, which would bring zod and every contract into this island.
 */
export function parseRetryAfter(value: string | null, now: number): number | null {
  const text = value?.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return Number(text)
  const at = Date.parse(text)
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000))
}

export interface ResponseMeta {
  /** Time the API spent on the request, from X-Response-Time (ms). */
  serverMs: number | null
  limit: number | null
  remaining: number | null
  /** Seconds until the rate-limit window starts over. */
  resetSeconds: number | null
  /** Seconds to wait, from Retry-After. */
  retryAfter: number | null
  location: string | null
}

/** `receivedAt` (epoch ms) turns a Retry-After date into seconds. */
export function readMeta(lines: readonly HeaderLine[], receivedAt: number): ResponseMeta {
  return {
    serverMs: parseServerTime(headerValue(lines, 'x-response-time')),
    limit: parseCount(headerValue(lines, 'x-ratelimit-limit')),
    remaining: parseCount(headerValue(lines, 'x-ratelimit-remaining')),
    resetSeconds: parseCount(headerValue(lines, 'x-ratelimit-reset')),
    retryAfter: parseRetryAfter(headerValue(lines, 'retry-after'), receivedAt),
    location: headerValue(lines, 'location'),
  }
}

// --- Body ---------------------------------------------------------------------------------------------------

export type Body =
  | { kind: 'empty' }
  | { kind: 'json'; value: unknown; text: string }
  | { kind: 'text'; text: string }

/** The body as indented JSON when it is JSON, as it came otherwise, or empty (a 204). */
export function readBody(text: string): Body {
  if (text.trim() === '') return { kind: 'empty' }
  try {
    const value: unknown = JSON.parse(text)
    return { kind: 'json', value, text: JSON.stringify(value, null, 2) }
  } catch {
    return { kind: 'text', text }
  }
}

export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false
  const { error, message, fields } = value as Record<string, unknown>
  if (typeof error !== 'string' || error === '' || typeof message !== 'string' || message === '') return false
  if (fields === undefined) return true
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) return false
  return Object.values(fields).every(
    (problems) => Array.isArray(problems) && problems.every((p) => typeof p === 'string'),
  )
}

// --- Status -------------------------------------------------------------------------------------------------

export type StatusKind = 'success' | 'error'

export const statusKind = (status: number): StatusKind =>
  status >= 200 && status < 400 ? 'success' : 'error'

const STATUS_TEXT: Record<number, string> = {
  200: 'Correcto',
  201: 'Creado',
  204: 'Sin contenido',
  304: 'Sin cambios',
  400: 'Petición no válida',
  401: 'No autenticado',
  403: 'Prohibido',
  404: 'No encontrado',
  405: 'Método no permitido',
  409: 'Conflicto',
  413: 'Cuerpo demasiado grande',
  415: 'Tipo de contenido no admitido',
  422: 'No procesable',
  429: 'Demasiadas peticiones',
  500: 'Error interno',
  502: 'Puerta de enlace incorrecta',
  503: 'Servicio no disponible',
  504: 'La puerta de enlace no respondió a tiempo',
}

/** The meaning of a status code, in Spanish. */
export function statusText(status: number): string {
  const known = STATUS_TEXT[status]
  if (known) return known
  if (status >= 200 && status < 300) return 'Correcto'
  if (status >= 300 && status < 400) return 'Redirección'
  if (status >= 400 && status < 500) return 'Error en la petición'
  return 'Error del servidor'
}

// --- Numbers ------------------------------------------------------------------------------------------------

const decimal = new Intl.NumberFormat('es', { maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('es', { maximumFractionDigits: 0 })

/** `154 ms`, `1,2 ms` or, from one second up, `48,2 s`. */
export function formatDuration(ms: number): string {
  if (ms >= 1000) return `${decimal.format(ms / 1000)} s`
  return `${(ms < 10 ? decimal : whole).format(ms)} ms`
}

export function seconds(count: number): string {
  return count === 1 ? '1 segundo' : `${whole.format(count)} segundos`
}

// --- Errors -------------------------------------------------------------------------------------------------

export interface FieldProblem {
  field: string
  problems: string[]
}

export interface ErrorExplanation {
  /** `error` of the ApiError body, or `null` when the body is not an ApiError. */
  code: string | null
  /** The API's own message (already Spanish), or one written here when the body is not an ApiError. */
  message: string
  /** What it means and what to do next. */
  advice: string
  fields: FieldProblem[]
}

interface ExplainContext {
  retryAfter: number | null
  limit: number | null
}

function rateLimitAdvice({ retryAfter, limit }: ExplainContext): string {
  const budget = limit === null ? 'un número limitado de peticiones' : `${limit} peticiones`
  const wait =
    retryAfter === null
      ? 'Espera un momento y vuelve a intentarlo.'
      : `Espera ${seconds(retryAfter)} (lo dice la cabecera Retry-After) y vuelve a intentarlo.`
  return `La API acepta ${budget} por minuto desde cada conexión, para frenar el abuso. ${wait}`
}

function adviceFor(code: string, hasFields: boolean, context: ExplainContext): string | null {
  switch (code) {
    case 'invalid_request':
      return hasFields
        ? 'La API revisó la petición con sus esquemas de validación y la rechazó antes de tocar tus datos. Corrige cada campo de la lista y vuelve a enviarla.'
        : 'La API no pudo leer la petición. Revisa la ruta, los parámetros y el cuerpo.'
    case 'not_found':
      return 'Lo que pediste no existe: puede que la tarea ya no esté en tu sandbox o que la ruta esté mal escrita. Lista las tareas para ver los ids que sí existen, o revisa los endpoints en la documentación.'
    case 'sandbox_full':
      return 'Tu sandbox llegó al máximo de tareas. Borra alguna o usa Empezar de cero.'
    case 'rate_limited':
      return rateLimitAdvice(context)
    case 'payload_too_large':
      return 'El cuerpo pasa del tamaño que acepta la API. Envía menos datos.'
    case 'unsupported_media_type':
      return 'Envía el cuerpo como JSON, con la cabecera Content-Type: application/json.'
    case 'method_not_allowed':
      return 'Esta ruta no acepta ese método. Revisa en la documentación cuáles admite.'
    case 'conflict':
      return 'La petición choca con el estado actual de los datos. Vuelve a leerlos y ajusta la petición.'
    case 'internal':
      return 'Algo falló dentro del servidor; no es por tu petición. Inténtalo de nuevo en un momento.'
    default:
      return null
  }
}

function adviceForStatus(status: number, context: ExplainContext): string {
  if (status === 429) return rateLimitAdvice(context)
  if (status >= 500) return 'El servidor no pudo responder. Inténtalo de nuevo en un momento.'
  return 'Revisa la ruta, los parámetros y el cuerpo, y vuelve a intentarlo.'
}

/** What an error answer means. `null` for 2xx and 3xx. */
export function explainError(status: number, body: Body, context: ExplainContext): ErrorExplanation | null {
  if (statusKind(status) === 'success') return null
  const value = body.kind === 'json' ? body.value : undefined
  if (isApiError(value)) {
    const fields = Object.entries(value.fields ?? {}).map(([field, problems]) => ({ field, problems }))
    return {
      code: value.error,
      message: value.message,
      advice: adviceFor(value.error, fields.length > 0, context) ?? adviceForStatus(status, context),
      fields,
    }
  }
  return {
    code: null,
    message: `La API respondió ${status} (${statusText(status)}) sin el formato de error de siempre.`,
    advice: adviceForStatus(status, context),
    fields: [],
  }
}
