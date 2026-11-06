import type { AssistantSessionStatus } from '@aim/contracts'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AnswerTexts, streamAnswer } from '../assistant/answer'
import { ChatRequest, toLlmMessages } from '../assistant/chat'
import { SYSTEM_PROMPT } from '../assistant/prompt'
import {
  ASSISTANT_SESSION_TTL_SECONDS,
  assistantSessionSecondsLeft,
  issueAssistantSession,
  readAssistantCookie,
  requireAssistantSession,
  setAssistantCookie,
} from '../assistant/session'
import type { AppEnv } from '../deps'
import { fail, validate } from '../lib/http'
import { log } from '../lib/log'
import { REVIEW_UNAVAILABLE, reviewRoutes } from './review'

/**
 * Lab assistant (DEC-011): POST /api/assistant/session (Turnstile once, then a 30-minute cookie), GET of the
 * same path (does the cookie still hold a session?) and POST /api/assistant/messages (the answer streamed as
 * Server-Sent Events: `delta`, then `done` or `error`). The code reviewer lives under this path too
 * (POST /api/assistant/review, ./review.ts), so the same cookie serves both.
 */
export const assistantRoutes = new Hono<AppEnv>()

const UNAVAILABLE =
  'El asistente no está disponible en este momento. Escríbele a David por WhatsApp o desde /contacto/ y te responde personalmente.'

// Without a model the assistant and the reviewer say so, and the rest of the API keeps working.
assistantRoutes.use(async (c, next) => {
  if (c.var.deps.llm) return next()
  const message = c.req.path.endsWith('/review') ? REVIEW_UNAVAILABLE : UNAVAILABLE
  return fail(c, 503, 'assistant_unavailable', message)
})

const SessionRequest = z.object({
  turnstileToken: z
    .string({ error: 'Completa la verificación de seguridad para continuar.' })
    .min(1, { error: 'Completa la verificación de seguridad para continuar.' })
    .max(2048, {
      error: 'La verificación de seguridad no es válida. Recarga la página e inténtalo de nuevo.',
    }),
})

assistantRoutes.post('/session', validate('json', SessionRequest), async (c) => {
  const { turnstileToken } = c.req.valid('json')
  const deps = c.var.deps

  let human: boolean
  try {
    human = await deps.captcha.verify(turnstileToken, c.var.clientIp)
  } catch (err) {
    log.error('turnstile verification failed', err)
    return fail(
      c,
      503,
      'captcha_unavailable',
      'No pudimos comprobar la verificación de seguridad en este momento. Inténtalo de nuevo en unos minutos.',
    )
  }
  if (!human) {
    return fail(
      c,
      422,
      'captcha_failed',
      'No pudimos confirmar que eres una persona. Recarga la página y completa la verificación para continuar.',
    )
  }

  setAssistantCookie(c, await issueAssistantSession(deps.env.JWT_SECRET, deps.now()))
  return c.json({ expiresIn: ASSISTANT_SESSION_TTL_SECONDS })
})

/** The cookie is HttpOnly: the reviewer's page asks here before showing the verification again. */
assistantRoutes.get('/session', async (c) => {
  const token = readAssistantCookie(c)
  const { env, now } = c.var.deps
  const left = token ? await assistantSessionSecondsLeft(env.JWT_SECRET, token, now()) : null
  const status: AssistantSessionStatus =
    left === null ? { active: false, expiresIn: 0 } : { active: true, expiresIn: left }
  return c.json(status)
})

const CHAT_TEXTS: AnswerTexts = {
  busy: 'El asistente está recibiendo muchas preguntas en este momento. Espera un minuto y vuelve a intentarlo.',
  failed:
    'El asistente no pudo terminar la respuesta. Inténtalo de nuevo o escríbele a David por WhatsApp o desde /contacto/.',
  refusal:
    'No puedo ayudarte con eso. Si tienes preguntas sobre los servicios de AIM, con gusto te respondo.',
  // The reviewer counts in the same limits, so the message names both.
  hourly: (wait) =>
    `Ya usaste varias veces el asistente o el revisor de código en la última hora. Vuelve a intentarlo en ${wait} o escríbele a David por WhatsApp.`,
  daily: (wait) =>
    `El asistente llegó a su límite de mensajes por hoy. Vuelve a intentarlo en ${wait} o escríbele a David por WhatsApp o desde /contacto/.`,
}

assistantRoutes.post(
  '/messages',
  requireAssistantSession(
    'Tu sesión con el asistente venció. Completa de nuevo la verificación de seguridad para seguir conversando.',
  ),
  validate('json', ChatRequest),
  async (c) => {
    const { messages } = c.req.valid('json')
    const { env, llm } = c.var.deps
    if (!llm) return fail(c, 503, 'assistant_unavailable', UNAVAILABLE)
    const request = {
      model: env.ASSISTANT_MODEL,
      system: SYSTEM_PROMPT,
      messages: toLlmMessages(messages),
      maxTokens: env.ASSISTANT_MAX_TOKENS,
    }
    return streamAnswer(c, llm, request, CHAT_TEXTS)
  },
)

assistantRoutes.route('/review', reviewRoutes)
