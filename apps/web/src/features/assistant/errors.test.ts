import { describe, expect, it } from 'vitest'
import { ApiRequestError } from '../../lib/api'
import {
  ASSISTANT_TEXTS,
  AssistantStreamError,
  CONNECTION_LOST,
  cookiesProblem,
  INVALID_STREAM,
  PAUSED_TITLE,
  type ProblemTexts,
  STREAM_INTERRUPTED,
  toProblem,
  waitText,
} from './errors'

const http = (
  status: number,
  code: string,
  message = 'Mensaje del servidor.',
  retryAfter: number | null = null,
) => new ApiRequestError({ status, code, message, retryAfter })

describe('waitText', () => {
  it.each([
    [1, '1 minuto'],
    [60, '1 minuto'],
    [61, '2 minutos'],
    [59 * 60, '59 minutos'],
    [60 * 60, '1 hora'],
    [60 * 60 + 1, '2 horas'],
    [0, '1 minuto'],
  ])('%i seconds read as %s', (seconds, expected) => {
    expect(waitText(seconds)).toBe(expected)
  })
})

describe('toProblem', () => {
  it('asks for a new verification on 401, whatever the body said', () => {
    const problem = toProblem(http(401, 'http_401', 'Tu sesión terminó. Vuelve a entrar con tu correo.'))
    expect(problem.kind).toBe('session')
    expect(problem.message).toMatch(/Completa de nuevo la verificación/)
    expect(problem.message).not.toMatch(/correo/)
  })

  it("keeps the API's 429 message, which already says how long to wait", () => {
    const message =
      'Ya enviaste varios mensajes al asistente en la última hora. Vuelve a intentarlo en 12 minutos.'
    expect(toProblem(http(429, 'rate_limited', message, 700))).toEqual({
      kind: 'rate_limited',
      message,
      retryable: false,
      retryAfter: 700,
    })
  })

  it('writes the wait itself when the 429 did not come from the API', () => {
    expect(toProblem(http(429, 'http_429', 'x', 3600)).message).toBe(
      'Enviaste muchos mensajes seguidos. Vuelve a intentarlo en 1 hora.',
    )
    expect(toProblem(http(429, 'http_429', 'x', null)).message).toBe(
      'Enviaste muchos mensajes seguidos. Espera unos minutos y vuelve a intentarlo.',
    )
  })

  it('reads 503 as a pause, with the other channels', () => {
    const problem = toProblem(http(503, 'assistant_unavailable'))
    expect(problem.kind).toBe('paused')
    expect(problem.message.startsWith(PAUSED_TITLE)).toBe(true)
    expect(problem.message).toMatch(/WhatsApp/)
    expect(problem.retryable).toBe(false)
    expect(toProblem(http(503, 'http_503')).kind).toBe('paused')
  })

  it('reads a missing /api (404) as a pause too', () => {
    expect(toProblem(http(404, 'not_found')).kind).toBe('paused')
  })

  it('keeps a failed Turnstile check apart from the pause', () => {
    expect(toProblem(http(503, 'captcha_unavailable', 'No pudimos comprobar la verificación.'))).toEqual({
      kind: 'server',
      message: 'No pudimos comprobar la verificación.',
      retryable: true,
      retryAfter: null,
    })
    expect(toProblem(http(422, 'captcha_failed', 'No pudimos confirmar que eres una persona.'))).toEqual({
      kind: 'request',
      message: 'No pudimos confirmar que eres una persona.',
      retryable: false,
      retryAfter: null,
    })
  })

  it("shows the API's message for other client errors, without a retry", () => {
    const problem = toProblem(http(400, 'invalid_request', 'Revisa los datos marcados e inténtalo de nuevo.'))
    expect(problem).toMatchObject({ kind: 'request', retryable: false })
    expect(problem.message).toBe('Revisa los datos marcados e inténtalo de nuevo.')
  })

  it('offers a retry on server errors, with a generic message when the body was not the API', () => {
    expect(toProblem(http(500, 'internal', 'Algo falló de nuestro lado.'))).toMatchObject({
      kind: 'server',
      message: 'Algo falló de nuestro lado.',
      retryable: true,
    })
    expect(toProblem(http(502, 'http_502')).message).toBe(
      'El servidor no pudo responder. Inténtalo de nuevo en unos minutos.',
    )
    expect(toProblem(http(200, 'invalid_response')).kind).toBe('server')
  })

  it('explains a request that never reached the server', () => {
    expect(toProblem(http(0, 'network_error'))).toMatchObject({
      kind: 'network',
      message: 'No hay conexión con el asistente. Revisa tu internet e inténtalo de nuevo.',
      retryable: true,
    })
  })

  it('shows the message of an error event, and no retry after a refusal', () => {
    expect(toProblem(new AssistantStreamError('assistant_busy', 'Espera un minuto.'))).toMatchObject({
      kind: 'answer',
      message: 'Espera un minuto.',
      retryable: true,
    })
    expect(
      toProblem(new AssistantStreamError('assistant_refusal', 'No puedo ayudarte con eso.')),
    ).toMatchObject({
      kind: 'answer',
      message: 'No puedo ayudarte con eso.',
      retryable: false,
    })
    expect(toProblem(new AssistantStreamError('something_new', '')).message).toBe(
      'El asistente no pudo terminar la respuesta. Inténtalo de nuevo.',
    )
  })

  it('tells apart a lost connection, a cut stream and an unreadable one', () => {
    expect(toProblem(new AssistantStreamError(CONNECTION_LOST, 'x'))).toMatchObject({
      kind: 'network',
      retryable: true,
    })
    expect(toProblem(new AssistantStreamError(CONNECTION_LOST, 'x')).message).toMatch(/Se cortó la conexión/)
    expect(toProblem(new AssistantStreamError(STREAM_INTERRUPTED, 'x'))).toMatchObject({
      kind: 'interrupted',
      message: 'La respuesta se cortó antes de terminar. Inténtalo de nuevo.',
      retryable: true,
    })
    expect(toProblem(new AssistantStreamError(INVALID_STREAM, 'x'))).toMatchObject({
      kind: 'server',
      retryable: true,
    })
  })

  it('never shows the text of an unexpected error', () => {
    const problem = toProblem(new TypeError('Cannot read properties of undefined'))
    expect(problem.kind).toBe('server')
    expect(problem.message).not.toMatch(/undefined/)
  })

  it('explains a session the browser does not keep', () => {
    expect(cookiesProblem()).toMatchObject({ kind: 'cookies', retryable: false })
    expect(cookiesProblem().message).toMatch(/cookies/)
  })
})

describe('texts of another feature (the code reviewer)', () => {
  const texts: ProblemTexts = {
    ...ASSISTANT_TEXTS,
    session: 'Sesión del revisor.',
    paused: 'Revisor en pausa.',
    connectionLost: 'Se cortó la revisión.',
    cookies: 'Cookies del revisor.',
    rateLimited: (wait) => `Muchas revisiones${wait ? ` (${wait})` : ''}.`,
  }

  it("uses the feature's own words for what the browser detects", () => {
    expect(toProblem(http(401, 'assistant_session_required'), texts).message).toBe('Sesión del revisor.')
    expect(toProblem(http(503, 'assistant_unavailable'), texts)).toMatchObject({
      kind: 'paused',
      message: 'Revisor en pausa.',
    })
    expect(toProblem(new AssistantStreamError(CONNECTION_LOST, 'x'), texts).message).toBe(
      'Se cortó la revisión.',
    )
    expect(cookiesProblem(texts).message).toBe('Cookies del revisor.')
    expect(toProblem(http(429, 'http_429', 'x', 700), texts).message).toBe('Muchas revisiones (12 minutos).')
    expect(toProblem(http(429, 'http_429'), texts).message).toBe('Muchas revisiones.')
  })

  it("keeps the API's own messages", () => {
    expect(toProblem(http(429, 'rate_limited', 'Comparten el límite.', 700), texts).message).toBe(
      'Comparten el límite.',
    )
    expect(
      toProblem(new AssistantStreamError('assistant_busy', 'El revisor está ocupado.'), texts).message,
    ).toBe('El revisor está ocupado.')
  })
})
