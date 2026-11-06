import { generateKeyPair } from 'oauth4webapi'
import { describe, expect, it } from 'vitest'
import { decodeBase64url, encodeText } from './base64url'
import { decodeJwt, readSegment, signJwt, verifyJwtSignature, withPayload } from './jwt'

const keys = await generateKeyPair('ES256')
const header = { alg: 'ES256', typ: 'JWT', kid: 'k1' }
const payload = { sub: '42', email: 'ana@example.com', n: 1 }
const token = await signJwt(header, payload, keys.privateKey)

describe('signJwt and decodeJwt', () => {
  it('produces three base64url segments that decode back to header and payload', () => {
    const decoded = decodeJwt(token)
    expect(decoded.header).toEqual(header)
    expect(decoded.payload).toEqual(payload)
    expect(decoded.parts.join('.')).toBe(token)
    expect(decodeBase64url(decoded.parts[2])).toHaveLength(64)
  })

  it('refuses anything that is not three segments of JSON objects', () => {
    const [h, p, s] = token.split('.')
    expect(() => decodeJwt(`${h}.${p}`)).toThrow()
    expect(() => decodeJwt(`${h}.${p}.${s}.x`)).toThrow()
    expect(() => decodeJwt(`${h}.${encodeText('not json')}.${s}`)).toThrow()
    expect(() => decodeJwt(`${h}.${encodeText('[1,2]')}.${s}`)).toThrow()
    expect(() => decodeJwt(`${h}.${p}.***`)).toThrow()
  })

  it('reads single segments for display without throwing', () => {
    expect(readSegment(token.split('.')[0] ?? '')).toEqual(header)
    expect(readSegment('***')).toBeNull()
  })
})

describe('verifyJwtSignature', () => {
  it('accepts an untouched token', async () => {
    expect(await verifyJwtSignature(token, keys.publicKey)).toBe(true)
  })

  it('rejects a token whose payload was altered', async () => {
    const forged = withPayload(token, JSON.stringify({ ...payload, email: 'admin@example.com' }))
    expect(decodeJwt(forged).payload.email).toBe('admin@example.com')
    expect(await verifyJwtSignature(forged, keys.publicKey)).toBe(false)
  })

  it('rejects even a change that keeps the same claims in another order', async () => {
    const reordered = withPayload(token, JSON.stringify({ n: 1, email: payload.email, sub: payload.sub }))
    expect(decodeJwt(reordered).payload).toEqual(payload)
    expect(await verifyJwtSignature(reordered, keys.publicKey)).toBe(false)
  })

  it('rejects an altered signature', async () => {
    const [h, p, s = ''] = token.split('.')
    const flipped = `${s.slice(0, 10)}${s[10] === 'A' ? 'B' : 'A'}${s.slice(11)}`
    expect(await verifyJwtSignature(`${h}.${p}.${flipped}`, keys.publicKey)).toBe(false)
    expect(await verifyJwtSignature(`${h}.${p}.`, keys.publicKey)).toBe(false)
  })

  it('rejects a token signed with another key', async () => {
    const other = await generateKeyPair('ES256')
    expect(await verifyJwtSignature(await signJwt(header, payload, other.privateKey), keys.publicKey)).toBe(
      false,
    )
  })

  it('refuses unsigned tokens (alg "none")', async () => {
    const [, p] = token.split('.')
    expect(await verifyJwtSignature(`${encodeText('{"alg":"none"}')}.${p}.`, keys.publicKey)).toBe(false)
  })

  it('returns false instead of throwing on garbage', async () => {
    expect(await verifyJwtSignature('not a token', keys.publicKey)).toBe(false)
  })
})
