import { Hono, type MiddlewareHandler } from 'hono'
import { type SSEStreamingApi, streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { ChatRequest, toLlmMessages } from '../assistant/chat'
import { SYSTEM_PROMPT } from '../assistant/prompt'
import {
  ASSISTANT_SESSION_TTL_SECONDS,
  issueAssistantSession,
  readAssistantCookie,
  setAssistantCookie,
  verifyAssistantSession,
} from '../assistant/session'
import { assistantLimitHit, type LimitHit, recordUsage, releaseUsage, reserveUsage } from '../assistant/usage'
import { type AppEnv, type Db, type Llm, LlmError, type LlmEvent, type LlmRequest } from '../deps'
import { fail, validate } from '../lib/http'
import { log } from '../lib/log'

/**
 * Lab assistant (DEC-011): POST /api/assistant/session (Turnstile once, then a 30-minute cookie) and
 * POST /api/assistant/messages (the answer streamed as Server-Sent Events: `delta`, then `done` or `error`).
 */
export const assistantRoutes = new Hono<AppEnv>()

const UNAVAILABLE =
  'El asistente no está disponible en este momento. Escríbele a David por WhatsApp o desde /contacto/ y te responde personalmente.'

// Without ANTHROPIC_API_KEY there is no model: the assistant says so and the rest of the API keeps working.
assistantRoutes.use(async (c, next) => {
  if (!c.var.deps.llm) return fail(c, 503, 'assistant_unavailable', UNAVAILABLE)
  return next()
})

const SessionRequest = z.object({
  turnstileToken: z
    .string({ error: 'Completa la verificación de seguridad para hablar con el asistente.' })
    .min(1, { error: 'Completa la verificación de seguridad para hablar con el asistente.' })
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
      'No pudimos confirmar que eres una persona. Recarga la página y completa la verificación para hablar con el asistente.',
    )
  }

  setAssistantCookie(c, await issueAssistantSession(deps.env.JWT_SECRET, deps.now()))
  return c.json({ expiresIn: ASSISTANT_SESSION_TTL_SECONDS })
})

/** 401 without a valid assistant session (an admin token has another audience and is refused too). */
const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = readAssistantCookie(c)
  const { env, now } = c.var.deps
  if (!token || !(await verifyAssistantSession(env.JWT_SECRET, token, now()))) {
    return fail(
      c,
      401,
      'assistant_session_required',
      'Tu sesión con el asistente venció. Completa de nuevo la verificación de seguridad para seguir conversando.',
    )
  }
  return next()
}

assistantRoutes.post('/messages', requireSession, validate('json', ChatRequest), async (c) => {
  const { messages } = c.req.valid('json')
  const { deps, ipHash } = c.var
  const { env, llm } = deps
  if (!llm) return fail(c, 503, 'assistant_unavailable', UNAVAILABLE)

  const db = await deps.db()
  const now = deps.now()
  const limits = { perHour: env.ASSISTANT_MESSAGES_PER_HOUR, perDay: env.ASSISTANT_DAILY_LIMIT }
  const hit = await assistantLimitHit(db, { ipHash, now, limits })
  if (hit) {
    c.header('Retry-After', String(hit.retryAfter))
    return fail(c, 429, hit.scope === 'daily' ? 'assistant_daily_limit' : 'rate_limited', limitMessage(hit))
  }
  const usageId = await reserveUsage(db, { ipHash, model: env.ASSISTANT_MODEL, at: now })

  // The answer streams after this handler returns: the request's resources (the database connection) are
  // released once this background task settles (see createApp).
  let finished = () => {}
  deps.waitUntil(
    new Promise<void>((resolve) => {
      finished = resolve
    }),
  )
  return streamSSE(c, async (stream) => {
    try {
      await answer(stream, {
        db,
        llm,
        usageId,
        request: {
          model: env.ASSISTANT_MODEL,
          system: SYSTEM_PROMPT,
          messages: toLlmMessages(messages),
          maxTokens: env.ASSISTANT_MAX_TOKENS,
        },
      })
    } finally {
      finished()
    }
  })
})

const BUSY =
  'El asistente está recibiendo muchas preguntas en este momento. Espera un minuto y vuelve a intentarlo.'
const FAILED =
  'El asistente no pudo terminar la respuesta. Inténtalo de nuevo o escríbele a David por WhatsApp o desde /contacto/.'
const REFUSAL =
  'No puedo ayudarte con eso. Si tienes preguntas sobre los servicios de AIM, con gusto te respondo.'

interface Answer {
  db: Db
  llm: Llm
  usageId: string
  request: Omit<LlmRequest, 'signal'>
}

async function answer(stream: SSEStreamingApi, { db, llm, usageId, request }: Answer) {
  const abort = new AbortController()
  // The visitor closed the page: stop the model so nobody pays for tokens nobody reads.
  stream.onAbort(() => abort.abort())
  let wrote = false
  let done: Extract<LlmEvent, { type: 'done' }> | undefined
  try {
    for await (const event of llm.stream({ ...request, signal: abort.signal })) {
      if (event.type === 'text') {
        wrote = true
        await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: event.text }) })
      } else {
        done = event
      }
    }
    if (!done) throw new Error('the model stream ended without a final event')
  } catch (err) {
    if (abort.signal.aborted) return
    log.error('assistant answer failed', err)
    if (!wrote) await releaseUsage(db, usageId).catch((e) => log.error('assistant usage release failed', e))
    const busy = err instanceof LlmError && err.busy
    await writeError(stream, busy ? 'assistant_busy' : 'assistant_failed', busy ? BUSY : FAILED)
    return
  }

  if (done.stopReason === 'refusal') await writeError(stream, 'assistant_refusal', REFUSAL)
  else await stream.writeSSE({ event: 'done', data: JSON.stringify({ reason: done.stopReason }) })
  await recordUsage(db, usageId, done.usage).catch((err) => log.error('assistant usage update failed', err))
}

function writeError(stream: SSEStreamingApi, error: string, message: string) {
  return stream.writeSSE({ event: 'error', data: JSON.stringify({ error, message }) })
}

function limitMessage(hit: LimitHit): string {
  const wait = waitText(hit.retryAfter)
  return hit.scope === 'daily'
    ? `El asistente llegó a su límite de mensajes por hoy. Vuelve a intentarlo en ${wait} o escríbele a David por WhatsApp o desde /contacto/.`
    : `Ya enviaste varios mensajes al asistente en la última hora. Vuelve a intentarlo en ${wait} o escríbele a David por WhatsApp.`
}

function waitText(seconds: number): string {
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`
  const hours = Math.ceil(minutes / 60)
  return `${hours} ${hours === 1 ? 'hora' : 'horas'}`
}
