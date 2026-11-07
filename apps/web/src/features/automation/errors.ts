import type { AutomationErrorCode } from '@aim/contracts'
import { ApiRequestError, messageForStatus } from '../../lib/api'

/**
 * Every way a run can fail, as something the island can show: a Spanish message that says what happened and
 * what to do. The API's own messages are kept when they arrive; the rest are written here.
 */

export type ProblemKind =
  /** 400: the fields say what to fix. */
  | 'invalid'
  /** Turnstile refused the token or could not be checked: a new verification fixes it. */
  | 'captcha'
  /** No API behind /api at all (404): this deploy has no automation. */
  | 'paused'
  /** An `error` event of the stream: the flow failed on the server. */
  | 'internal'
  /** No connection, or it dropped during the run. */
  | 'network'
  /** The stream ended without `done` or `error`. */
  | 'interrupted'
  /** Anything else the server answered (403 origin, 413, 5xx, an unexpected body). */
  | 'server'

export interface Problem {
  kind: ProblemKind
  message: string
  /** Field errors of a 400, by path (`lead.email`). */
  fields: Record<string, string[]>
}

/** Client codes of AutomationStreamError. */
export const CONNECTION_LOST = 'connection_lost'
export const STREAM_INTERRUPTED = 'interrupted'
export const INVALID_STREAM = 'invalid_response'

/** The stream broke or did not look like the contract. */
export class AutomationStreamError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AutomationStreamError'
    this.code = code
  }
}

export const TEXTS = {
  network: 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.',
  connectionLost: 'Se cortó la conexión durante la ejecución. Revisa tu internet e inténtalo de nuevo.',
  interrupted: 'La ejecución se cortó antes de terminar. Inténtalo de nuevo.',
  invalid:
    'La respuesta del servidor llegó con un formato inesperado. Recarga la página e inténtalo de nuevo.',
  paused: 'La demo de automatización está en pausa.',
  unknown: 'Algo falló al ejecutar la demo. Inténtalo de nuevo en unos minutos.',
  stream: {
    internal: 'Algo falló de nuestro lado durante la ejecución. Inténtalo de nuevo en unos minutos.',
  } satisfies Record<AutomationErrorCode, string>,
}

const problem = (kind: ProblemKind, message: string, fields: Problem['fields'] = {}): Problem => ({
  kind,
  message,
  fields,
})

/** An `error` event of the stream. */
export function streamErrorProblem(code: AutomationErrorCode, message: string): Problem {
  return problem(code, message || TEXTS.stream[code])
}

/** True when the body was not the API's own error (a proxy page, an old deploy): its message is generic. */
const genericBody = (error: ApiRequestError) => error.code.startsWith('http_')

function httpProblem(error: ApiRequestError): Problem {
  const { status, code, retryAfter } = error
  const own = !genericBody(error) && error.code !== 'invalid_response'
  if (status === 0) return problem('network', TEXTS.network)
  if (status === 400) return problem('invalid', error.message, error.fields)
  if (code === 'captcha_failed' || code === 'captcha_unavailable') return problem('captcha', error.message)
  // 404: this deploy has no automation behind /api. The visitor needs the other channels.
  if (status === 404) return problem('paused', TEXTS.paused)
  if (code === 'invalid_response') return problem('server', TEXTS.invalid)
  // Anything else (413, 5xx, a proxy's 429…): the API's own message, or a generic one for the status.
  return problem('server', own ? error.message : messageForStatus(status, retryAfter))
}

/** Maps whatever the client threw to the problem the island shows. */
export function toProblem(error: unknown): Problem {
  if (error instanceof AutomationStreamError) {
    if (error.code === CONNECTION_LOST) return problem('network', TEXTS.connectionLost)
    if (error.code === STREAM_INTERRUPTED) return problem('interrupted', TEXTS.interrupted)
    return problem('server', TEXTS.invalid)
  }
  if (error instanceof ApiRequestError) return httpProblem(error)
  return problem('server', TEXTS.unknown)
}
