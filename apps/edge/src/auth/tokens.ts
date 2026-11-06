import { type Principal, SCOPES, type Scope } from '@aim/contracts'
import { jwtVerify, SignJWT } from 'jose'

// Access tokens (DEC-017): short-lived JWTs, HS256, bound to this API by issuer and audience.

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60
export const ISSUER = 'aim-edge'
export const AUDIENCE = 'aim-admin'

/** Cookie names. `__Host-` pins the access cookie to this origin and path `/`; the refresh cookie only travels to /api/auth. */
export const ACCESS_COOKIE = '__Host-aim_at'
export const REFRESH_COOKIE = '__Secure-aim_rt'
export const REFRESH_COOKIE_PATH = '/api/auth'

/** Every admin gets every scope today; the middleware still checks them so new roles only change this list. */
export const ADMIN_SCOPES: readonly Scope[] = SCOPES

const encoder = new TextEncoder()
const key = (secret: string) => encoder.encode(secret)

export async function issueAccessToken(
  secret: string,
  subject: string,
  scope: readonly Scope[],
  now: Date,
): Promise<{ token: string; expiresIn: number }> {
  const iat = Math.floor(now.getTime() / 1000)
  const token = await new SignJWT({ scope: scope.join(' ') })
    .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(subject)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TOKEN_TTL_SECONDS)
    .setJti(crypto.randomUUID())
    .sign(key(secret))
  return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS }
}

/** Verifies signature, algorithm, issuer, audience and expiry. Returns null for any invalid token. */
export async function verifyAccessToken(secret: string, token: string, now: Date): Promise<Principal | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      typ: 'at+jwt',
      currentDate: now,
    })
    if (!payload.sub || typeof payload.exp !== 'number' || typeof payload.scope !== 'string') return null
    const scope = payload.scope
      .split(' ')
      .filter((s): s is Scope => (SCOPES as readonly string[]).includes(s))
    return { sub: payload.sub, scope, exp: payload.exp }
  } catch {
    return null
  }
}
