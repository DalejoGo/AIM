import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../deps'
import { hmac } from '../lib/crypto'
import { fail } from '../lib/http'

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
 * Browsers always send Origin on cross-origin and same-origin POST/PATCH/DELETE fetches.
 */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next()
  const origin = c.req.header('origin')
  if (origin !== new URL(c.var.deps.env.SITE_ORIGIN).origin) {
    return fail(c, 403, 'forbidden_origin', 'Esta solicitud solo se acepta desde el sitio de AIM.')
  }
  return next()
}
