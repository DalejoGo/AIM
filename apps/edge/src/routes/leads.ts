import { Hono } from 'hono'
import type { AppEnv } from '../deps'
import { notifyNewLead } from '../leads/notify'
import { insertLead } from '../leads/repository'
import { leadRetryAfter, toNewLead, validLeadSubmission } from '../leads/submission'
import { fail } from '../lib/http'
import { log } from '../lib/log'

/** POST /api/leads — contact form and cotizador (DEC-014). */
export const leadRoutes = new Hono<AppEnv>()

leadRoutes.post('/', validLeadSubmission, async (c) => {
  const input = c.req.valid('json')
  const deps = c.var.deps

  // Turnstile first: bots without a valid token never open a database connection.
  let human: boolean
  try {
    human = await deps.captcha.verify(input.turnstileToken, c.var.clientIp)
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
      'No pudimos confirmar que eres una persona. Recarga la página, completa la verificación y vuelve a enviar el formulario.',
    )
  }

  const db = await deps.db()
  const now = deps.now()
  const retryAfter = await leadRetryAfter(db, c.var.ipHash, now)
  if (retryAfter !== null) {
    const minutes = Math.ceil(retryAfter / 60)
    c.header('Retry-After', String(retryAfter))
    return fail(
      c,
      429,
      'rate_limited',
      `Ya recibimos varios mensajes desde tu conexión en la última hora. Inténtalo de nuevo en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`,
    )
  }

  const lead = toNewLead(input, c.var.ipHash, now)
  const id = await insertLead(db, lead)
  deps.waitUntil(notifyNewLead(deps.mailer, deps.env, { ...lead, id }))
  return c.json({ id }, 201)
})
