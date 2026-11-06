import { describe, expect, it } from 'vitest'
import { buildAuthorizationUrl, demo, parseAuthorizationUrl } from './authorization'
import { verifyIdToken } from './idToken'
import { decodeJwt } from './jwt'
import { createClientSession } from './pkce'
import { createSigningKey, exchangeCode, issueGrant, type TokenRequest } from './server'

const NOW = 1_800_000_000
const session = await createClientSession()
const parsed = parseAuthorizationUrl(buildAuthorizationUrl(session))
if (!parsed.ok) throw new Error('The demo authorization URL must be valid')
const grant = issueGrant(parsed.request)
const key = await createSigningKey()

const request: TokenRequest = {
  grant_type: 'authorization_code',
  code: grant.code,
  redirect_uri: demo.redirectUri,
  client_id: demo.clientId,
  code_verifier: session.codeVerifier,
}

describe('createSigningKey', () => {
  it('publishes only the public half and keeps the private key unexportable', async () => {
    expect(key.publicJwk).toEqual({
      kty: 'EC',
      crv: 'P-256',
      x: expect.any(String),
      y: expect.any(String),
      kid: key.kid,
      alg: 'ES256',
      use: 'sig',
    })
    expect(key.privateKey.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('jwk', key.privateKey)).rejects.toThrow()
  })
})

describe('issueGrant', () => {
  it('issues a fresh, unguessable code each time', () => {
    expect(grant.code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(issueGrant(grant.request).code).not.toBe(grant.code)
  })
})

describe('exchangeCode', () => {
  it('returns tokens when code and verifier match', async () => {
    const result = await exchangeCode(grant, request, key, NOW)
    if (!result.ok) throw new Error(`Expected tokens, got ${result.error}`)
    expect(result.response).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: demo.scope })
    expect(result.response.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(decodeJwt(result.response.id_token).header).toEqual({ alg: 'ES256', typ: 'JWT', kid: key.kid })
    const verdict = await verifyIdToken(result.response.id_token, {
      publicKey: key.publicKey,
      issuer: demo.issuer,
      audience: demo.clientId,
      nonce: session.nonce,
      now: NOW,
    })
    expect(verdict.ok).toBe(true)
  })

  it('rejects a stolen code sent with another verifier', async () => {
    const attacker = await createClientSession()
    const result = await exchangeCode(grant, { ...request, code_verifier: attacker.codeVerifier }, key, NOW)
    expect(result).toMatchObject({
      ok: false,
      error: 'invalid_grant',
      reason: 'pkce',
      pkce: { reason: 'mismatch' },
    })
  })

  it('rejects a malformed verifier as an invalid request', async () => {
    const result = await exchangeCode(grant, { ...request, code_verifier: 'too-short' }, key, NOW)
    expect(result).toMatchObject({ ok: false, error: 'invalid_request', pkce: { reason: 'malformed' } })
  })

  it('rejects a wrong code, client, redirect_uri or grant type', async () => {
    const cases: [Partial<TokenRequest>, string][] = [
      [{ code: 'guessed-code' }, 'code'],
      [{ client_id: 'other-app' }, 'client'],
      [{ redirect_uri: 'https://evil.example/callback' }, 'redirect_uri'],
      [{ grant_type: 'password' }, 'grant_type'],
    ]
    for (const [change, reason] of cases) {
      expect(await exchangeCode(grant, { ...request, ...change }, key, NOW)).toMatchObject({
        ok: false,
        reason,
      })
    }
  })
})
