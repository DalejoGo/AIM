import { describe, expect, it } from 'vitest'
import { decodeBase64url, decodeText, encodeBase64url, encodeText, randomBase64url } from './base64url'

describe('base64url', () => {
  it('uses the URL-safe alphabet without padding', () => {
    expect(encodeBase64url(new Uint8Array([0xfb, 0xff]))).toBe('-_8')
    expect(encodeBase64url(new Uint8Array([]))).toBe('')
    expect(encodeText('a')).toBe('YQ')
  })

  it('round-trips bytes and UTF-8 text', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(97))
    expect(decodeBase64url(encodeBase64url(bytes))).toEqual(bytes)
    expect(decodeText(encodeText('Peña, señal y café ☕'))).toBe('Peña, señal y café ☕')
  })

  it('rejects standard base64, padding and impossible lengths', () => {
    expect(() => decodeBase64url('+/8')).toThrow()
    expect(() => decodeBase64url('YQ==')).toThrow()
    expect(() => decodeBase64url('YQ.')).toThrow()
    expect(() => decodeBase64url('YWJjZ')).toThrow()
  })

  it('rejects non-canonical input that would decode to the same bytes', () => {
    expect(decodeBase64url('-_8')).toEqual(new Uint8Array([0xfb, 0xff]))
    expect(() => decodeBase64url('-_9')).toThrow()
  })

  it('rejects bytes that are not UTF-8 when text is expected', () => {
    expect(() => decodeText(encodeBase64url(new Uint8Array([0xff, 0xfe])))).toThrow()
  })

  it('produces random values of the requested size', () => {
    expect(decodeBase64url(randomBase64url(32))).toHaveLength(32)
    expect(randomBase64url()).not.toBe(randomBase64url())
  })
})
