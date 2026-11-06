import { generateKeyPair } from 'oauth4webapi'
import { type AuthorizationRequest, demo } from './authorization'
import { randomBase64url } from './base64url'
import { type JsonObject, signJwt } from './jwt'
import { type PkceCheck, verifyPkce } from './pkce'

// The simulated authorization server. It runs in your browser, so every value it signs is real but disposable.

/** A made-up account; example.com is reserved for documentation. */
export const demoUser = { sub: '248289761001', name: 'Ana Ejemplo', email: 'ana@example.com' } as const

export interface SigningKey {
  kid: string
  privateKey: CryptoKey
  publicKey: CryptoKey
  /** What the server would publish at its JWKS URL. */
  publicJwk: JsonWebKey & { kid: string; alg: 'ES256'; use: 'sig' }
}

/** An ephemeral ES256 key pair. The private key cannot be exported, not even by this page. */
export async function createSigningKey(): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair('ES256')
  const kid = randomBase64url(8)
  const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', publicKey)
  return { kid, privateKey, publicKey, publicJwk: { kty, crv, x, y, kid, alg: 'ES256', use: 'sig' } }
}

/** What the server remembers about a code it issued after your consent (step 3). */
export interface AuthorizationGrant {
  code: string
  request: AuthorizationRequest
}

export function issueGrant(request: AuthorizationRequest): AuthorizationGrant {
  return { code: randomBase64url(32), request }
}

export interface TokenRequest {
  grant_type: string
  code: string
  redirect_uri: string
  client_id: string
  code_verifier: string
}

export interface TokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  scope: string
  id_token: string
}

export type TokenError = 'unsupported_grant_type' | 'invalid_grant' | 'invalid_request'

export type TokenResult =
  | { ok: true; response: TokenResponse; pkce: PkceCheck }
  | {
      ok: false
      error: TokenError
      reason: 'grant_type' | 'code' | 'client' | 'redirect_uri' | 'pkce'
      pkce?: PkceCheck
    }

export const TOKEN_LIFETIME = 3600

export function createIdTokenClaims(grant: AuthorizationGrant, now: number): JsonObject {
  return {
    iss: demo.issuer,
    sub: demoUser.sub,
    aud: grant.request.clientId,
    exp: now + TOKEN_LIFETIME,
    iat: now,
    nonce: grant.request.nonce,
    name: demoUser.name,
    email: demoUser.email,
  }
}

export function signIdToken(claims: JsonObject, key: SigningKey): Promise<string> {
  return signJwt({ alg: 'ES256', typ: 'JWT', kid: key.kid }, claims, key.privateKey)
}

/** Token endpoint (step 5): the code must match its grant, and the verifier must hash to the stored challenge. */
export async function exchangeCode(
  grant: AuthorizationGrant,
  request: TokenRequest,
  key: SigningKey,
  now: number,
): Promise<TokenResult> {
  if (request.grant_type !== 'authorization_code') {
    return { ok: false, error: 'unsupported_grant_type', reason: 'grant_type' }
  }
  if (request.code !== grant.code) return { ok: false, error: 'invalid_grant', reason: 'code' }
  if (request.client_id !== grant.request.clientId) {
    return { ok: false, error: 'invalid_grant', reason: 'client' }
  }
  if (request.redirect_uri !== grant.request.redirectUri) {
    return { ok: false, error: 'invalid_grant', reason: 'redirect_uri' }
  }
  const pkce = await verifyPkce(request.code_verifier, grant.request.codeChallenge)
  if (!pkce.ok) {
    return {
      ok: false,
      error: pkce.reason === 'malformed' ? 'invalid_request' : 'invalid_grant',
      reason: 'pkce',
      pkce,
    }
  }
  return {
    ok: true,
    pkce,
    response: {
      access_token: randomBase64url(32),
      token_type: 'Bearer',
      expires_in: TOKEN_LIFETIME,
      scope: grant.request.scope,
      id_token: await signIdToken(createIdTokenClaims(grant, now), key),
    },
  }
}
