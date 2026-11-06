import { describe, expect, it } from 'vitest'
import { parseCount, parsePolicyWindow, rateLimitLines, readRateLimit } from './rateLimit'

describe('parseCount', () => {
  it('reads non-negative integers and ignores anything else', () => {
    expect(['10', ' 0 ', '007'].map(parseCount)).toEqual([10, 0, 7])
    expect([null, '', ' ', '-1', '1.5', '10s', 'diez'].map(parseCount)).toEqual(Array(7).fill(null))
  })
})

describe('parsePolicyWindow', () => {
  it('reads the window of the draft policy syntaxes', () => {
    expect(parsePolicyWindow('10;w=10')).toBe(10)
    expect(parsePolicyWindow('"burst";q=100;w=60')).toBe(60)
    expect(parsePolicyWindow('10; w = 30')).toBe(30)
  })

  it('returns null without a valid window', () => {
    expect(parsePolicyWindow(null)).toBeNull()
    expect(parsePolicyWindow('10')).toBeNull()
    expect(parsePolicyWindow('10;w=')).toBeNull()
    expect(parsePolicyWindow('10;w=1.5')).toBeNull()
    expect(parsePolicyWindow('10;sw=5')).toBeNull()
  })
})

describe('readRateLimit', () => {
  it('reads every field the API sends with a 429', () => {
    const headers = new Headers({
      'RateLimit-Policy': '10;w=10',
      'RateLimit-Limit': '10',
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': '7',
      'Retry-After': '7',
    })
    expect(readRateLimit(headers)).toEqual({
      limit: 10,
      remaining: 0,
      reset: 7,
      windowSeconds: 10,
      retryAfter: 7,
    })
  })

  it('accepts Retry-After as an HTTP date', () => {
    const now = Date.parse('2026-11-06T15:00:00Z')
    const headers = new Headers({ 'Retry-After': 'Fri, 06 Nov 2026 15:00:12 GMT' })
    expect(readRateLimit(headers, now).retryAfter).toBe(12)
  })

  it('leaves out what did not arrive or is not valid', () => {
    const headers = new Headers({ 'RateLimit-Remaining': 'muchas', 'Retry-After': 'pronto' })
    expect(readRateLimit(headers)).toEqual({
      limit: null,
      remaining: null,
      reset: null,
      windowSeconds: null,
      retryAfter: null,
    })
  })
})

describe('rateLimitLines', () => {
  it('lists the rate-limit fields that arrived, in a fixed order and untouched', () => {
    const headers = new Headers({
      'retry-after': '7',
      'content-type': 'application/json',
      'ratelimit-remaining': '0',
      'ratelimit-limit': '10',
    })
    expect(rateLimitLines(headers)).toEqual([
      { name: 'RateLimit-Limit', value: '10' },
      { name: 'RateLimit-Remaining', value: '0' },
      { name: 'Retry-After', value: '7' },
    ])
  })
})
