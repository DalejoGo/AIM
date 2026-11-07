import { AutomationRunRequest, type AutomationStatus, AutomationStepReport } from '@aim/contracts'
import { Hono, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { streamSSE } from 'hono/streaming'
import { createRun, pruneRuns, recordStep, takeRunSlot } from '../automation/repository'
import { streamRun } from '../automation/run'
import { verifyCallbackToken } from '../automation/token'
import type { AppEnv } from '../deps'
import { SERVICE_LABELS } from '../leads/notify'
import { fail, validate } from '../lib/http'
import { log } from '../lib/log'

/**
 * Lab demo "Automatización en vivo" (docs/AUTOMATIZACION.md):
 * - GET /api/automation/status: is n8n awake? The page asks when it opens, which starts waking it up.
 * - POST /api/automation/runs: the visitor's test lead. Turnstile, limits, then the run as Server-Sent Events.
 * - POST /api/automation/runs/:runId/events: n8n reports each step, authenticated only by the run's token.
 */
export const automationRoutes = new Hono<AppEnv>()

/**
 * The n8n callback, server to server: POST /api/automation/runs/<uuid>/events and nothing else. sameOrigin
 * (middleware/security.ts) skips only this path, because n8n sends no Origin and carries no cookie: the Bearer
 * token for this exact run is what proves the request, so a cross-site page cannot forge one.
 */
export const AUTOMATION_CALLBACK_PATH =
  /^\/api\/automation\/runs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/events$/

/** A test lead is under 4 KB of JSON and a step under 3 KB; anything far bigger is refused unread. */
const MAX_BODY_BYTES = 16 * 1024

const tooLarge = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => fail(c, 413, 'payload_too_large', 'La solicitud es demasiado grande.'),
})

const UNAVAILABLE =
  'La demo de automatización no está disponible en este momento. Escríbele a David por WhatsApp o desde /contacto/ y te cuenta cómo funciona.'

const requireN8n: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.var.deps.n8n) return next()
  return fail(c, 503, 'automation_unavailable', UNAVAILABLE)
}

/**
 * How long GET /status waits for n8n: plenty for an awake one, short enough to answer `waking` quickly. Cutting
 * the request does not stop the wake-up: once it reaches Render, Render boots the service anyway.
 */
export const STATUS_TIMEOUT_MS = 3_000

/**
 * GET /api/automation/status: one readiness check (one subrequest), no database and no Turnstile: a safe GET
 * the page sends on load and every few seconds while n8n wakes up, so the run starts at once when the visitor
 * sends the form. No rate limit on purpose: n8n's URL is public, so limiting this route would not protect
 * Render's free hours, and each call costs one subrequest and no database connection.
 */
automationRoutes.get('/status', async (c) => {
  const { n8n } = c.var.deps
  if (!n8n) return c.json<AutomationStatus>({ state: 'disabled' })
  const ready = await n8n.healthy(AbortSignal.timeout(STATUS_TIMEOUT_MS))
  return c.json<AutomationStatus>({ state: ready ? 'ready' : 'waking' })
})

const minutes = (seconds: number) => {
  const n = Math.max(1, Math.ceil(seconds / 60))
  return `${n} ${n === 1 ? 'minuto' : 'minutos'}`
}

const hours = (seconds: number) => {
  const n = Math.max(1, Math.ceil(seconds / 3600))
  return `${n} ${n === 1 ? 'hora' : 'horas'}`
}

automationRoutes.post('/runs', requireN8n, tooLarge, validate('json', AutomationRunRequest), async (c) => {
  const { turnstileToken, lead } = c.req.valid('json')
  const deps = c.var.deps
  const { env } = deps
  const n8n = deps.n8n
  if (!n8n) return fail(c, 503, 'automation_unavailable', UNAVAILABLE)

  // Turnstile first: bots without a valid token never open a database connection. One token per run.
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
      403,
      'captcha_failed',
      'No pudimos confirmar que eres una persona. Completa de nuevo la verificación y vuelve a intentarlo.',
    )
  }

  const db = await deps.db()
  const now = deps.now()
  const burstPolicy = {
    limit: env.AUTOMATION_BURST_LIMIT,
    windowSeconds: env.AUTOMATION_BURST_WINDOW_SECONDS,
  }
  const slot = await takeRunSlot(db, {
    ipHash: c.var.ipHash,
    now,
    limits: { burst: burstPolicy, daily: env.AUTOMATION_DAILY_LIMIT },
  })
  c.header('RateLimit-Policy', `${burstPolicy.limit};w=${burstPolicy.windowSeconds}`)
  c.header('RateLimit-Limit', String(slot.burst.limit))
  c.header('RateLimit-Remaining', String(slot.burst.remaining))
  c.header('RateLimit-Reset', String(slot.burst.resetInSeconds))
  if (slot.dailyRetryAfter !== null) {
    c.header('Retry-After', String(slot.dailyRetryAfter))
    return fail(
      c,
      503,
      'daily_limit',
      `La demo llegó a su límite de ejecuciones por hoy. Vuelve a intentarlo en ${hours(slot.dailyRetryAfter)} o escríbele a David por WhatsApp.`,
    )
  }
  if (!slot.burst.allowed) {
    c.header('Retry-After', String(slot.burst.resetInSeconds))
    return fail(
      c,
      429,
      'rate_limited',
      `Ya ejecutaste la demo ${burstPolicy.limit} ${burstPolicy.limit === 1 ? 'vez' : 'veces'} hace poco. Vuelve a intentarlo en ${minutes(slot.burst.resetInSeconds)}.`,
    )
  }

  await pruneRuns(db, now)
  const runId = await createRun(db, now)

  // The run streams after the handler returns: the request's resources (the database connection) are
  // released once it ends (see createApp). It ends when the flow does or when the visitor leaves.
  let finished = () => {}
  deps.waitUntil(
    new Promise<void>((resolve) => {
      finished = resolve
    }),
  )
  return streamSSE(c, async (stream) => {
    try {
      await streamRun(stream, {
        runId,
        lead,
        serviceTitle: SERVICE_LABELS[lead.service],
        db,
        n8n,
        secret: env.JWT_SECRET,
        now: deps.now,
        sleep: deps.sleep,
        wakeTimeoutMs: env.AUTOMATION_WAKE_TIMEOUT_SECONDS * 1000,
      })
    } finally {
      finished()
    }
  })
})

const BEARER = /^Bearer[ \t]+([A-Za-z0-9._~+/-]+=*)[ \t]*$/i

/** 401 unless the Bearer token was issued for this run (RFC 6750 error in WWW-Authenticate). */
const requireRunToken: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = BEARER.exec(c.req.header('authorization') ?? '')?.[1]
  const runId = c.req.param('runId') ?? ''
  const { env, now } = c.var.deps
  if (!token || !(await verifyCallbackToken(env.JWT_SECRET, token, runId, now()))) {
    c.header('WWW-Authenticate', 'Bearer error="invalid_token"')
    return fail(c, 401, 'invalid_token', 'El token no es válido, venció o es de otra ejecución.')
  }
  return next()
}

automationRoutes.post(
  '/runs/:runId/events',
  tooLarge,
  requireRunToken,
  validate('json', AutomationStepReport),
  async (c) => {
    const report = c.req.valid('json')
    const runId = c.req.param('runId')
    const deps = c.var.deps
    const result = await recordStep(await deps.db(), { runId, report, at: deps.now() })
    if (result === 'unknown_run') {
      // The token is ours but its run is gone (deleted after an hour): the same answer as a foreign token.
      c.header('WWW-Authenticate', 'Bearer error="invalid_token"')
      return fail(c, 401, 'invalid_token', 'Esta ejecución ya no existe.')
    }
    if (result === 'duplicate') {
      return fail(
        c,
        409,
        'step_already_reported',
        `El paso ${report.step} ya se reportó para esta ejecución.`,
      )
    }
    return c.body(null, 204)
  },
)
