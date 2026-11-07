import { AutomationRunRequest } from '@aim/contracts'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { streamSSE } from 'hono/streaming'
import { runEvents, writeEvents } from '../automation/run'
import type { AppEnv } from '../deps'
import { SERVICE_LABELS } from '../leads/notify'
import { fail, validate } from '../lib/http'
import { log } from '../lib/log'

/**
 * Lab demo "Automatización en vivo" (docs/AUTOMATIZACION.md, DEC-023). POST /api/automation/runs: the visitor's
 * test lead. Turnstile, then the flow runs here and its steps stream back as Server-Sent Events.
 *
 * No database and no rate limit on purpose: opening a Neon connection alone takes over a second, and a run costs
 * under a millisecond of CPU and nothing else. Turnstile's single-use token, one per run, is the abuse guard.
 */
export const automationRoutes = new Hono<AppEnv>()

/** A test lead is under 4 KB of JSON; anything far bigger is refused unread. */
const MAX_BODY_BYTES = 16 * 1024

const tooLarge = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => fail(c, 413, 'payload_too_large', 'La solicitud es demasiado grande.'),
})

automationRoutes.post('/runs', tooLarge, validate('json', AutomationRunRequest), async (c) => {
  const { turnstileToken, lead } = c.req.valid('json')
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
      403,
      'captcha_failed',
      'No pudimos confirmar que eres una persona. Completa de nuevo la verificación y vuelve a intentarlo.',
    )
  }

  // The flow runs before the response and keeps nothing: the run id only feeds the reference it shows. The
  // stream just writes these events.
  const events = runEvents({
    runId: crypto.randomUUID(),
    lead: { ...lead, serviceTitle: SERVICE_LABELS[lead.service] },
    now: deps.now,
  })
  return streamSSE(c, (stream) => writeEvents(stream, events))
})
