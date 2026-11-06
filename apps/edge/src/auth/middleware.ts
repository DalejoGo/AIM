import type { Scope } from '@aim/contracts'
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import type { AppEnv } from '../deps'
import { fail } from '../lib/http'
import { ACCESS_COOKIE, verifyAccessToken } from './tokens'

/**
 * Access middleware (DEC-017): accepts the access token from its HttpOnly cookie or an
 * `Authorization: Bearer` header (RFC 6750), and requires every listed scope.
 * 401 = no valid token (the client should refresh or log in); 403 = valid token without the scope.
 */
export function requireScope(...required: Scope[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header('authorization')
    const bearer = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : undefined
    const token = bearer ?? getCookie(c, ACCESS_COOKIE)
    const { env, now } = c.var.deps
    const principal = token ? await verifyAccessToken(env.JWT_SECRET, token, now()) : null

    if (!principal) {
      c.header('WWW-Authenticate', 'Bearer realm="aim-admin"')
      return fail(c, 401, 'unauthorized', 'Tu sesión venció o no has iniciado sesión.')
    }
    const missing = required.filter((s) => !principal.scope.includes(s))
    if (missing.length > 0) {
      c.header(
        'WWW-Authenticate',
        `Bearer realm="aim-admin", error="insufficient_scope", scope="${missing.join(' ')}"`,
      )
      return fail(c, 403, 'insufficient_scope', 'Tu cuenta no tiene permiso para esta acción.')
    }
    c.set('principal', principal)
    return next()
  }
}
