import { jwtVerify, SignJWT } from 'jose'
import { ISSUER } from '../auth/tokens'
import { deriveKey } from '../lib/crypto'

// The only credential n8n ever holds (docs/AUTOMATIZACION.md): a JWT for one run, sent in the webhook and
// returned as `Authorization: Bearer` with each step. HS256 with a key derived from JWT_SECRET for this
// purpose alone, so it can never pass for an admin or assistant token, nor be forged from one.

export const CALLBACK_AUDIENCE = 'aim-automation-callback'
export const CALLBACK_TOKEN_TTL_SECONDS = 5 * 60
const TOKEN_TYPE = 'aim-automation-callback+jwt'
const KEY_PURPOSE = 'automation-callback-jwt'

export async function issueCallbackToken(secret: string, runId: string, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: TOKEN_TYPE })
    .setIssuer(ISSUER)
    .setAudience(CALLBACK_AUDIENCE)
    .setSubject(runId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + CALLBACK_TOKEN_TTL_SECONDS)
    .sign(await deriveKey(secret, KEY_PURPOSE))
}

/** True only for an unexpired token this API issued for exactly this run. */
export async function verifyCallbackToken(
  secret: string,
  token: string,
  runId: string,
  now: Date,
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, await deriveKey(secret, KEY_PURPOSE), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: CALLBACK_AUDIENCE,
      typ: TOKEN_TYPE,
      subject: runId,
      currentDate: now,
      requiredClaims: ['sub', 'exp'],
    })
    return payload.sub === runId
  } catch {
    return false
  }
}
