import { describe, expect, it } from 'vitest'
import {
  BURST_SIZE,
  type BurstHit,
  countdownText,
  hitKind,
  progressText,
  secondsLeft,
  statusWord,
  summarizeBurst,
  summaryText,
} from './burst'

const hit = (n: number, status: number, retryAfter: number | null = null): BurstHit => ({
  n,
  status,
  ms: 40,
  remaining: status === 200 ? Math.max(0, 10 - n) : 0,
  retryAfter,
  headers: [],
})

/** 10 accepted, then 429s whose Retry-After goes down as time passes. */
const typical = [
  ...Array.from({ length: 10 }, (_, i) => hit(i + 1, 200)),
  ...[10, 10, 9, 9, 9].map((wait, i) => hit(11 + i, 429, wait)),
]

describe('hitKind and statusWord', () => {
  it('tells accepted, rate limited and failed answers apart', () => {
    expect([200, 204, 429, 500, 404, 0].map(hitKind)).toEqual([
      'passed',
      'passed',
      'blocked',
      'failed',
      'failed',
      'failed',
    ])
    expect([200, 429, 503, 0].map(statusWord)).toEqual(['aceptada', 'frenada', 'error', 'sin respuesta'])
  })
})

describe('summarizeBurst', () => {
  it('counts each kind and keeps the Retry-After of the last 429', () => {
    expect(summarizeBurst(typical)).toEqual({ sent: 15, passed: 10, blocked: 5, failed: 0, retryAfter: 9 })
  })

  it('has no wait when nothing was rate limited', () => {
    expect(summarizeBurst([hit(1, 200), hit(2, 503)])).toEqual({
      sent: 2,
      passed: 1,
      blocked: 0,
      failed: 1,
      retryAfter: null,
    })
    expect(summarizeBurst([])).toMatchObject({ sent: 0, retryAfter: null })
  })
})

describe('summaryText', () => {
  const text = (hits: BurstHit[]) => summaryText(summarizeBurst(hits))

  it('says how many passed and how many were stopped', () => {
    expect(text(typical)).toBe('10 pasaron y 5 fueron frenadas.')
    expect(text([hit(1, 200), hit(2, 429, 5)])).toBe('1 pasó y 1 fue frenada.')
  })

  it('covers a burst that never reached the limit and one that never got through', () => {
    expect(text(typical.slice(0, 10).map((h) => ({ ...h, status: 200 })))).toBe(
      'Las 10 pasaron: el límite no se alcanzó.',
    )
    expect(text([hit(1, 200)])).toBe('La petición pasó.')
    expect(text([hit(1, 429, 3), hit(2, 429, 3)])).toBe('Ninguna pasó: las 2 fueron frenadas.')
  })

  it('mentions the request that failed', () => {
    expect(text([hit(1, 200), hit(2, 200), hit(3, 500)])).toBe('2 pasaron y 1 falló.')
    expect(text([hit(1, 200), hit(2, 429, 4), hit(3, 0)])).toBe('1 pasó, 1 fue frenada y 1 falló.')
    expect(text([hit(1, 429, 4), hit(2, 503)])).toBe('Ninguna pasó, 1 fue frenada y 1 falló.')
    expect(text([hit(1, 0)])).toBe('La petición falló.')
  })

  it('is empty before the first answer', () => {
    expect(text([])).toBe('')
  })
})

describe('countdown', () => {
  it('rounds the seconds left up and never goes below zero', () => {
    const now = 1_000_000
    expect(secondsLeft(now + 9_001, now)).toBe(10)
    expect(secondsLeft(now + 1, now)).toBe(1)
    expect(secondsLeft(now, now)).toBe(0)
    expect(secondsLeft(now - 5_000, now)).toBe(0)
  })

  it('says how long to wait, and when the wait is over', () => {
    expect(countdownText(8)).toBe('Vuelve a intentarlo en 8 segundos.')
    expect(countdownText(1)).toBe('Vuelve a intentarlo en 1 segundo.')
    expect(countdownText(0)).toBe('Ya puedes volver a intentarlo.')
  })
})

describe('progressText', () => {
  it('names the request on its way', () => {
    expect(progressText(0)).toBe(`Enviando la petición 1 de ${BURST_SIZE}…`)
    expect(progressText(6)).toBe(`Enviando la petición 7 de ${BURST_SIZE}…`)
    expect(progressText(BURST_SIZE)).toBe(`Enviando la petición ${BURST_SIZE} de ${BURST_SIZE}…`)
  })
})
