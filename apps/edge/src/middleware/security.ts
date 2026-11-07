import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../deps'
import { hmac } from '../lib/crypto'
import { fail } from '../lib/http'
import { AUTOMATION_CALLBACK_PATH } from '../routes/automation'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** API responses are never cached and never sniffed. */
export const apiHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
  c.header('X-Content-Type-Options', 'nosniff')
}

/** Resolves the client IP (Cloudflare header) and keeps only its HMAC for rate limits and audit. */
export const clientIp: MiddlewareHandler<AppEnv> = async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') ?? null
  c.set('clientIp', ip)
  c.set('ipHash', await hmac(c.var.deps.env.JWT_SECRET, 'ip', ip ?? 'unknown'))
  await next()
}

/**
 * CSRF defence for cookie-authenticated and public forms: state-changing requests must come from the site itself.
 * Browsers always send Origin on cross-origin and same-origin POST/PATCH/DELETE fetches. Server-to-server
 * callbacks authenticated by a Bearer token are the only exception (see below).
 */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next()
  // The one exception: n8n's step reports (POST /api/automation/runs/<uuid>/events) come from a server, which
  // sends no Origin. That route reads no cookie and accepts only a Bearer token signed for that exact run
  // (routes/automation.ts), so there is no ambient credential for a cross-site request to ride on.
  if (c.req.method === 'POST' && AUTOMATION_CALLBACK_PATH.test(c.req.path)) return next()
  const origin = c.req.header('origin')
  if (origin !== new URL(c.var.deps.env.SITE_ORIGIN).origin) {
    return fail(c, 403, 'forbidden_origin', 'Esta solicitud solo se acepta desde el sitio de AIM.')
  }
  return next()
}
