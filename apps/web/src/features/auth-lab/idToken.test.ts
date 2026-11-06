import { describe, expect, it } from 'vitest'
import { demo } from './authorization'
import { encodeText } from './base64url'
import { type IdTokenExpectations, verifyIdToken } from './idToken'
import { decodeJwt, type JsonObject, withPayload } from './jwt'
import { createIdTokenClaims, createSigningKey, issueGrant, signIdToken } from './server'

const NOW = 1_800_000_000
const key = await createSigningKey()
const grant = issueGrant({
  clientId: demo.clientId,
  redirectUri: demo.redirectUri,
  scope: demo.scope,
  state: 'state-1',
  nonce: 'nonce-1',
  codeChallenge: 'challenge',
})
const claims = createIdTokenClaims(grant, NOW)
const token = await signIdToken(claims, key)

const expected: IdTokenExpectations = {
  publicKey: key.publicKey,
  issuer: demo.issuer,
  audience: demo.clientId,
  nonce: 'nonce-1',
  now: NOW + 60,
}

/** Signs a correct token with some claims changed: the signature stays valid, the claim check must fail. */
const signedWith = (changes: JsonObject) => signIdToken({ ...claims, ...changes }, key)

const failing = async (candidate: string, overrides: Partial<IdTokenExpectations> = {}) =>
  (await verifyIdToken(candidate, { ...expected, ...overrides })).checks.filter((c) => !c.ok).map((c) => c.id)

describe('verifyIdToken', () => {
  it('accepts a valid token and reports every check', async () => {
    const verdict = await verifyIdToken(token, expected)
    expect(verdict.ok).toBe(true)
    expect(verdict.checks.map((c) => c.id)).toEqual(['signature', 'issuer', 'audience', 'expiry', 'nonce'])
    expect(verdict.payload).toMatchObject({ email: 'ana@example.com', nonce: 'nonce-1' })
  })

  it('rejects a tampered payload through the signature', async () => {
    const forged = withPayload(token, JSON.stringify({ ...claims, email: 'admin@example.com' }))
    const verdict = await verifyIdToken(forged, expected)
    expect(verdict.ok).toBe(false)
    expect(await failing(forged)).toEqual(['signature'])
  })

  it('rejects a correctly signed token issued for another login (wrong nonce)', async () => {
    const foreign = await signedWith({ nonce: 'nonce-from-another-login' })
    expect((await verifyIdToken(foreign, expected)).ok).toBe(false)
    expect(await failing(foreign)).toEqual(['nonce'])
  })

  it('rejects a token whose nonce was swapped by hand on both counts', async () => {
    const swapped = withPayload(token, JSON.stringify({ ...claims, nonce: 'other' }))
    expect(await failing(swapped)).toEqual(['signature', 'nonce'])
  })

  it('rejects a token without nonce', async () => {
    const { nonce: _, ...withoutNonce } = claims
    expect(await failing(await signIdToken(withoutNonce, key))).toEqual(['nonce'])
  })

  it('rejects another issuer, another audience and an expired token', async () => {
    expect(await failing(await signedWith({ iss: 'https://evil.example' }))).toEqual(['issuer'])
    expect(await failing(await signedWith({ aud: 'other-app' }))).toEqual(['audience'])
    expect(await failing(token, { now: NOW + 3600 + 31 })).toEqual(['expiry'])
    expect(await failing(await signedWith({ exp: undefined }))).toEqual(['expiry'])
  })

  it('accepts an audience list that includes the app', async () => {
    expect(await failing(await signedWith({ aud: ['other-app', demo.clientId] }))).toEqual([])
  })

  it('rejects a token signed with a key the app does not trust', async () => {
    const stranger = await createSigningKey()
    expect(await failing(await signIdToken(claims, stranger))).toEqual(['signature'])
  })

  it('stops at the format check when the token cannot be read', async () => {
    const [h, , s] = token.split('.')
    for (const broken of ['', 'abc', `${h}.${encodeText('{"email":')}.${s}`]) {
      expect(await verifyIdToken(broken, expected)).toEqual({
        ok: false,
        checks: [{ id: 'format', ok: false }],
        payload: null,
      })
    }
  })

  it('carries the claims the server promised', () => {
    expect(decodeJwt(token).payload).toEqual({
      iss: demo.issuer,
      sub: '248289761001',
      aud: demo.clientId,
      exp: NOW + 3600,
      iat: NOW,
      nonce: 'nonce-1',
      name: 'Ana Ejemplo',
      email: 'ana@example.com',
    })
  })
})
