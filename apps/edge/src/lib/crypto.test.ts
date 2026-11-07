import { describe, expect, it } from 'vitest'
import { base64url, deriveKey, hmac, randomDigits, randomToken, timingSafeEqual } from './crypto'

describe('crypto helpers', () => {
  it('encodes base64url without padding', () => {
    expect(base64url(new Uint8Array([251, 255, 191]))).toBe('-_-_')
  })

  it('generates 6-digit codes, zero-padded', () => {
    for (let i = 0; i < 200; i++) expect(randomDigits()).toMatch(/^\d{6}$/)
  })

  it('generates distinct opaque tokens', () => {
    expect(randomToken()).not.toBe(randomToken())
    expect(randomToken(32)).toHaveLength(43)
  })

  it('separates HMACs by purpose', async () => {
    const secret = 'x'.repeat(32)
    expect(await hmac(secret, 'code', '123456')).toBe(await hmac(secret, 'code', '123456'))
    expect(await hmac(secret, 'code', '123456')).not.toBe(await hmac(secret, 'token', '123456'))
  })

  it('derives a stable 256-bit key per purpose, unlike the secret and other purposes', async () => {
    const secret = 'x'.repeat(32)
    const key = await deriveKey(secret, 'automation-callback')
    expect(key).toHaveLength(32)
    expect(base64url(await deriveKey(secret, 'automation-callback'))).toBe(base64url(key))
    expect(base64url(await deriveKey(secret, 'other'))).not.toBe(base64url(key))
    expect(base64url(await deriveKey('y'.repeat(32), 'automation-callback'))).not.toBe(base64url(key))
    expect(new TextDecoder().decode(key)).not.toContain(secret)
  })

  it('compares in constant time', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })
})
