import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { CookieOptions } from 'hono/utils/cookie'
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './tokens'

// Session cookies (DEC-017): invisible to scripts (HttpOnly), HTTPS only (Secure; browsers treat
// http://localhost as secure) and never sent on cross-site requests (SameSite=Strict).
// The names already carry their `__Host-` / `__Secure-` prefix, so Hono's `prefix` option is not used:
// it would prepend the prefix a second time. Hono still validates the prefix rules when serializing.

const BASE = { httpOnly: true, secure: true, sameSite: 'Strict' } as const satisfies CookieOptions

/** `__Host-` requires Path=/ and no Domain. */
const ACCESS_OPTIONS = { ...BASE, path: '/' } as const satisfies CookieOptions
/** The refresh token only travels to the token, revoke and me endpoints. */
const REFRESH_OPTIONS = { ...BASE, path: REFRESH_COOKIE_PATH } as const satisfies CookieOptions

export interface SessionCookies {
  access: string
  accessMaxAge: number
  refresh: string
  refreshMaxAge: number
}

export function setSessionCookies(c: Context, cookies: SessionCookies): void {
  setCookie(c, ACCESS_COOKIE, cookies.access, { ...ACCESS_OPTIONS, maxAge: cookies.accessMaxAge })
  setCookie(c, REFRESH_COOKIE, cookies.refresh, { ...REFRESH_OPTIONS, maxAge: cookies.refreshMaxAge })
}

/** Expires both cookies (Max-Age=0) with the same attributes and paths they were set with. */
export function clearSessionCookies(c: Context): void {
  deleteCookie(c, ACCESS_COOKIE, ACCESS_OPTIONS)
  deleteCookie(c, REFRESH_COOKIE, REFRESH_OPTIONS)
}

export function readRefreshCookie(c: Context): string | undefined {
  return getCookie(c, REFRESH_COOKIE) || undefined
}
