import {
  calculatePKCECodeChallenge,
  generateRandomCodeVerifier,
  generateRandomNonce,
  generateRandomState,
} from 'oauth4webapi'
import { encodeBase64url } from './base64url'

/** What the app creates and keeps in your session before sending you anywhere (step 1). */
export interface ClientSession {
  codeVerifier: string
  codeChallenge: string
  state: string
  nonce: string
}

/** Client side: random values from oauth4webapi's CSPRNG helpers, challenge with its S256 implementation. */
export async function createClientSession(): Promise<ClientSession> {
  const codeVerifier = generateRandomCodeVerifier()
  return {
    codeVerifier,
    codeChallenge: await calculatePKCECodeChallenge(codeVerifier),
    state: generateRandomState(),
    nonce: generateRandomNonce(),
  }
}

/** RFC 7636, section 4.1: 43 to 128 unreserved characters. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/

export function isWellFormedVerifier(verifier: string): boolean {
  return VERIFIER.test(verifier)
}

/** BASE64URL(SHA256(ASCII(verifier))), written independently from oauth4webapi: this is the server's copy. */
export async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return encodeBase64url(new Uint8Array(digest))
}

/** Compares every character so the time taken does not reveal how much of a secret matched. */
export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0)
  return diff === 0
}

export type PkceCheck =
  | { ok: true; computed: string }
  | { ok: false; reason: 'malformed' | 'mismatch'; computed: string }

/** Server side of PKCE (RFC 7636, section 4.6): the hash of the verifier must equal the stored challenge. */
export async function verifyPkce(verifier: string, challenge: string): Promise<PkceCheck> {
  const computed = await s256(verifier)
  if (!isWellFormedVerifier(verifier)) return { ok: false, reason: 'malformed', computed }
  return timingSafeEqual(computed, challenge)
    ? { ok: true, computed }
    : { ok: false, reason: 'mismatch', computed }
}
