import { decodeJwt, type JsonObject, verifyJwtSignature } from './jwt'

export type CheckId = 'format' | 'signature' | 'issuer' | 'audience' | 'expiry' | 'nonce'

export interface Check {
  id: CheckId
  ok: boolean
}

export interface IdTokenVerdict {
  ok: boolean
  checks: Check[]
  payload: JsonObject | null
}

export interface IdTokenExpectations {
  publicKey: CryptoKey
  issuer: string
  audience: string
  /** The nonce the app kept in step 1. */
  nonce: string
  /** Current time in seconds since the epoch. */
  now: number
}

/** Accepted difference between the server's clock and yours, in seconds. */
const CLOCK_TOLERANCE = 30

/**
 * App side of step 6 (OpenID Connect Core, section 3.1.3.7). Every check runs and is reported on its own,
 * so the demo can show which one failed; the token is accepted only when all of them pass.
 */
export async function verifyIdToken(token: string, expected: IdTokenExpectations): Promise<IdTokenVerdict> {
  let payload: JsonObject
  try {
    payload = decodeJwt(token).payload
  } catch {
    return { ok: false, checks: [{ id: 'format', ok: false }], payload: null }
  }
  const { aud, exp } = payload
  const checks: Check[] = [
    { id: 'signature', ok: await verifyJwtSignature(token, expected.publicKey) },
    { id: 'issuer', ok: payload.iss === expected.issuer },
    { id: 'audience', ok: Array.isArray(aud) ? aud.includes(expected.audience) : aud === expected.audience },
    { id: 'expiry', ok: typeof exp === 'number' && exp > expected.now - CLOCK_TOLERANCE },
    { id: 'nonce', ok: payload.nonce === expected.nonce },
  ]
  return { ok: checks.every((check) => check.ok), checks, payload }
}
