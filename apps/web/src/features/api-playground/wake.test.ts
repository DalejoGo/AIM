import { describe, expect, it } from 'vitest'
import {
  ASLEEP_AFTER_MS,
  failureText,
  isWaking,
  mayBeAsleep,
  REQUEST_TIMEOUT_MS,
  WAKE_HINT_AFTER_MS,
  WAKING_TEXT,
  wokeUpText,
} from './wake'

const NOW = Date.parse('2026-11-06T15:30:00Z')

describe('timings', () => {
  it('wait about 3 s before the notice and 75 s before giving up', () => {
    expect(WAKE_HINT_AFTER_MS).toBe(3000)
    expect(REQUEST_TIMEOUT_MS).toBe(75_000)
    expect(ASLEEP_AFTER_MS).toBeLessThan(15 * 60_000)
  })
})

describe('mayBeAsleep', () => {
  it('is true before the first answer of the session', () => {
    expect(mayBeAsleep(null, NOW)).toBe(true)
  })

  it('is false right after an answer and true again once Render may have put it to sleep', () => {
    expect(mayBeAsleep(NOW - 60_000, NOW)).toBe(false)
    expect(mayBeAsleep(NOW - ASLEEP_AFTER_MS + 1, NOW)).toBe(false)
    expect(mayBeAsleep(NOW - ASLEEP_AFTER_MS, NOW)).toBe(true)
  })
})

describe('isWaking', () => {
  it('shows the notice only for a slow request to an API that may be asleep', () => {
    expect(isWaking({ elapsedMs: 2999, asleep: true })).toBe(false)
    expect(isWaking({ elapsedMs: 3000, asleep: true })).toBe(true)
    expect(isWaking({ elapsedMs: 30_000, asleep: false })).toBe(false)
  })
})

describe('texts', () => {
  it('say what is going on', () => {
    expect(WAKING_TEXT).toBe(
      'La API está despertando (plan gratuito de Render); puede tardar hasta un minuto.',
    )
    expect(wokeUpText(48_230)).toBe(
      'La API estaba dormida y tardó 48,2 s en arrancar. Las siguientes peticiones serán rápidas.',
    )
    expect(failureText('timeout', true)).toBe(
      'La API no respondió en 75 segundos. Puede que siga despertando: vuelve a intentarlo.',
    )
    expect(failureText('network', false)).toMatch(/No pudimos conectar/)
    expect(failureText('network', true)).toMatch(/mientras la API despertaba/)
  })
})
