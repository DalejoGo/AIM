import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { jwtVerify, SignJWT } from 'jose'
import { ISSUER } from '../auth/tokens'

// Visitor session of the Lab assistant: the visitor solves Turnstile once and then chats for 30 minutes.
// It is a JWT signed with JWT_SECRET like the admin's access token, but with its own audience and type, so
// neither token is accepted in place of the other.

export const ASSISTANT_SESSION_TTL_SECONDS = 30 * 60
export const ASSISTANT_AUDIENCE = 'aim-assistant'
const TOKEN_TYPE = 'aim-assistant+jwt'

/** `__Secure-` (not `__Host-`): the cookie only travels to /api/assistant, and `__Host-` requires Path=/. */
export const ASSISTANT_COOKIE = '__Secure-aim_assistant'
export const ASSISTANT_COOKIE_PATH = '/api/assistant'

const encoder = new TextEncoder()

export async function issueAssistantSession(secret: string, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000)
  return (
    new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: TOKEN_TYPE })
      .setIssuer(ISSUER)
      .setAudience(ASSISTANT_AUDIENCE)
      // A random id: the session says nothing about the visitor.
      .setSubject(crypto.randomUUID())
      .setIssuedAt(iat)
      .setExpirationTime(iat + ASSISTANT_SESSION_TTL_SECONDS)
      .sign(encoder.encode(secret))
  )
}

/** True for a token this API issued for the assistant and that has not expired. */
export async function verifyAssistantSession(secret: string, token: string, now: Date): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: ASSISTANT_AUDIENCE,
      typ: TOKEN_TYPE,
      currentDate: now,
      requiredClaims: ['sub', 'exp'],
    })
    return typeof payload.sub === 'string'
  } catch {
    return false
  }
}

/** HttpOnly, Secure, SameSite=Strict, only sent to /api/assistant. */
export function setAssistantCookie(c: Context, token: string): void {
  setCookie(c, ASSISTANT_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: ASSISTANT_COOKIE_PATH,
    maxAge: ASSISTANT_SESSION_TTL_SECONDS,
  })
}

export function readAssistantCookie(c: Context): string | undefined {
  return getCookie(c, ASSISTANT_COOKIE) || undefined
}
