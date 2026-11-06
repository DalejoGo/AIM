import { calculatePKCECodeChallenge } from 'oauth4webapi'
import { describe, expect, it } from 'vitest'
import { createClientSession, isWellFormedVerifier, s256, timingSafeEqual, verifyPkce } from './pkce'

// RFC 7636, appendix B.
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

/** The same string with one character swapped, as a careless or malicious edit would do. */
const flipLast = (value: string) => `${value.slice(0, -1)}${value.endsWith('A') ? 'B' : 'A'}`

describe('S256 challenge', () => {
  it('matches the RFC 7636 test vector', async () => {
    expect(await s256(RFC_VERIFIER)).toBe(RFC_CHALLENGE)
  })

  it('agrees with oauth4webapi, which the app side uses', async () => {
    expect(await calculatePKCECodeChallenge(RFC_VERIFIER)).toBe(RFC_CHALLENGE)
  })
})

describe('createClientSession', () => {
  it('creates a well-formed verifier with its challenge, plus state and nonce', async () => {
    const session = await createClientSession()
    expect(isWellFormedVerifier(session.codeVerifier)).toBe(true)
    expect(session.codeChallenge).toBe(await s256(session.codeVerifier))
    expect(session.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(session.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('never repeats values between sessions', async () => {
    const [a, b] = await Promise.all([createClientSession(), createClientSession()])
    expect(a.codeVerifier).not.toBe(b.codeVerifier)
    expect(a.state).not.toBe(b.state)
    expect(a.nonce).not.toBe(b.nonce)
  })
})

describe('verifyPkce', () => {
  it('accepts the original verifier', async () => {
    expect(await verifyPkce(RFC_VERIFIER, RFC_CHALLENGE)).toEqual({ ok: true, computed: RFC_CHALLENGE })
  })

  it('rejects a verifier altered by one character', async () => {
    const result = await verifyPkce(flipLast(RFC_VERIFIER), RFC_CHALLENGE)
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: 'mismatch' })
    expect(result.computed).not.toBe(RFC_CHALLENGE)
  })

  it('rejects a valid verifier that belongs to someone else', async () => {
    const attacker = await createClientSession()
    expect(await verifyPkce(attacker.codeVerifier, RFC_CHALLENGE)).toMatchObject({
      ok: false,
      reason: 'mismatch',
    })
  })

  it('rejects malformed verifiers even before comparing', async () => {
    for (const verifier of ['', 'short', `${RFC_VERIFIER}!`, 'a'.repeat(129), 'ñ'.repeat(43)]) {
      expect(await verifyPkce(verifier, RFC_CHALLENGE)).toMatchObject({ ok: false, reason: 'malformed' })
    }
  })

  it('does not accept the challenge itself as a verifier ("plain" is not allowed)', async () => {
    expect(await verifyPkce(RFC_CHALLENGE, RFC_CHALLENGE)).toMatchObject({ ok: false, reason: 'mismatch' })
  })
})

describe('timingSafeEqual', () => {
  it('compares whole strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
    expect(timingSafeEqual('', 'a')).toBe(false)
    expect(timingSafeEqual('', '')).toBe(true)
  })
})
