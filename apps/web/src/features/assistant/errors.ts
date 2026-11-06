import { ApiRequestError, messageForStatus } from '../../lib/api'

/**
 * Every way a question can fail, as something the island can show: a Spanish message that says what happened
 * and what to do, and whether sending the same question again can work.
 */

export type ProblemKind =
  /** 401: the 30-minute session ended; a new verification fixes it. */
  | 'session'
  /** A new session was refused right after it was issued: the browser is not keeping the cookie. */
  | 'cookies'
  | 'rate_limited'
  /** 503 (no API key) or no assistant behind /api at all. */
  | 'paused'
  | 'network'
  /** An `error` event in the stream: the model failed, was busy or refused. */
  | 'answer'
  /** The stream ended without `done` or `error`. */
  | 'interrupted'
  /** 400, 403, 422: retrying the same request will not help. */
  | 'request'
  | 'server'

export interface Problem {
  kind: ProblemKind
  message: string
  /** True when sending the same question again may work. */
  retryable: boolean
  /** Seconds to wait before asking again (429), when the API said it. */
  retryAfter: number | null
}

/** Raised by the client for an `error` event, or when the stream breaks or is not what was expected. */
export class AssistantStreamError extends Error {
  /** The `error` of the event (assistant_busy, assistant_failed, assistant_refusal) or a client code. */
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AssistantStreamError'
    this.code = code
  }
}

/** Client codes of AssistantStreamError. */
export const STREAM_INTERRUPTED = 'interrupted'
export const CONNECTION_LOST = 'connection_lost'
export const INVALID_STREAM = 'invalid_response'

export const PAUSED_TITLE = 'El asistente está en pausa'

const MESSAGES = {
  session:
    'Tu sesión con el asistente venció. Completa de nuevo la verificación de seguridad para seguir conversando.',
  cookies:
    'El asistente no pudo mantener tu sesión. Revisa que tu navegador acepte las cookies de este sitio y recarga la página.',
  paused: `${PAUSED_TITLE}. Mientras vuelve, escríbele a David por WhatsApp o desde el formulario de contacto.`,
  network: 'No hay conexión con el asistente. Revisa tu internet e inténtalo de nuevo.',
  connectionLost:
    'Se cortó la conexión mientras llegaba la respuesta. Revisa tu internet e inténtalo de nuevo.',
  interrupted: 'La respuesta se cortó antes de terminar. Inténtalo de nuevo.',
  invalid:
    'La respuesta del asistente llegó con un formato inesperado. Recarga la página e inténtalo de nuevo.',
  failed: 'El asistente no pudo terminar la respuesta. Inténtalo de nuevo.',
  unknown: 'Algo falló al hablar con el asistente. Inténtalo de nuevo en unos minutos.',
} as const

/** "5 minutos", "1 hora": the same rounding as the API's own messages. */
export function waitText(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60))
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`
  const hours = Math.ceil(minutes / 60)
  return `${hours} ${hours === 1 ? 'hora' : 'horas'}`
}

function rateLimitMessage(retryAfter: number | null): string {
  return retryAfter === null
    ? 'Enviaste muchos mensajes seguidos. Espera unos minutos y vuelve a intentarlo.'
    : `Enviaste muchos mensajes seguidos. Vuelve a intentarlo en ${waitText(retryAfter)}.`
}

const problem = (
  kind: ProblemKind,
  message: string,
  retryable: boolean,
  retryAfter: number | null = null,
) => ({
  kind,
  message,
  retryable,
  retryAfter,
})

/** The session was renewed and still refused: a second verification would not help. */
export const cookiesProblem = (): Problem => problem('cookies', MESSAGES.cookies, false)

/** True when the body was not the API's own error (a proxy page, an old deploy): its message is generic. */
const genericBody = (error: ApiRequestError) => error.code.startsWith('http_')

function streamProblem(error: AssistantStreamError): Problem {
  switch (error.code) {
    case CONNECTION_LOST:
      return problem('network', MESSAGES.connectionLost, true)
    case STREAM_INTERRUPTED:
      return problem('interrupted', MESSAGES.interrupted, true)
    case INVALID_STREAM:
      return problem('server', MESSAGES.invalid, true)
    case 'assistant_refusal':
      return problem('answer', error.message || MESSAGES.failed, false)
    default:
      return problem('answer', error.message || MESSAGES.failed, true)
  }
}

function httpProblem(error: ApiRequestError): Problem {
  const { status, code } = error
  if (status === 0) return problem('network', MESSAGES.network, true)
  if (status === 401) return problem('session', MESSAGES.session, true)
  if (status === 429) {
    const message = genericBody(error) ? rateLimitMessage(error.retryAfter) : error.message
    return problem('rate_limited', message, false, error.retryAfter)
  }
  // 404: this deploy has no assistant behind /api. Either way the visitor needs the other channels.
  if ((status === 503 && code !== 'captcha_unavailable') || status === 404) {
    return problem('paused', MESSAGES.paused, false)
  }
  if (code === 'invalid_response') return problem('server', MESSAGES.invalid, true)
  if (status >= 500)
    return problem('server', genericBody(error) ? messageForStatus(status) : error.message, true)
  return problem('request', error.message, false)
}

/** Maps whatever a session or a question threw to the problem the island shows. */
export function toProblem(error: unknown): Problem {
  if (error instanceof AssistantStreamError) return streamProblem(error)
  if (error instanceof ApiRequestError) return httpProblem(error)
  return problem('server', MESSAGES.unknown, true)
}
