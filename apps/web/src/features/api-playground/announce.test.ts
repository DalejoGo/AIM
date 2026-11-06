import { describe, expect, it } from 'vitest'
import { resultAnnouncement } from './announce'
import type { Outcome } from './client'
import type { Exchange } from './history'

function exchange(outcome: Outcome, slowStart = false): Exchange {
  return {
    id: 'e1',
    at: 0,
    request: { method: 'GET', path: '/api/v1/tasks', body: null },
    outcome,
    slowStart,
  }
}

const response = (status: number, body: string, headers: Record<string, string> = {}): Outcome => ({
  kind: 'response',
  status,
  body,
  headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
  totalMs: 154,
})

describe('resultAnnouncement', () => {
  it('reads the status and the total time of a success', () => {
    expect(resultAnnouncement(exchange(response(201, '{"id":"x"}')))).toBe(
      'Respuesta 201, Creado, en 154 ms.',
    )
  })

  it('adds the API message and how many fields failed', () => {
    const body = JSON.stringify({
      error: 'invalid_request',
      message: 'Hay datos que no son válidos. Revisa los campos marcados.',
      fields: { title: ['Corto.'], priority: ['No vale.'] },
    })
    expect(resultAnnouncement(exchange(response(400, body)))).toBe(
      'Respuesta 400, Petición no válida, en 154 ms. Hay datos que no son válidos. Revisa los campos marcados. Hay 2 campos con problemas.',
    )
    const one = JSON.stringify({
      error: 'invalid_request',
      message: 'Revisa.',
      fields: { title: ['Corto.'] },
    })
    expect(resultAnnouncement(exchange(response(400, one)))).toMatch(/Hay 1 campo con problemas\.$/)
  })

  it('says how long to wait after a 429', () => {
    const body =
      '{"error":"rate_limited","message":"Hiciste demasiadas peticiones. Intenta de nuevo en 42 s."}'
    expect(resultAnnouncement(exchange(response(429, body, { 'retry-after': '42' })))).toBe(
      'Respuesta 429, Demasiadas peticiones, en 154 ms. Hiciste demasiadas peticiones. Intenta de nuevo en 42 s. Espera 42 segundos.',
    )
  })

  it('explains a request that got no answer', () => {
    expect(resultAnnouncement(exchange({ kind: 'timeout', totalMs: 75_000 }, true))).toMatch(
      /no respondió en 75 segundos/,
    )
    expect(resultAnnouncement(exchange({ kind: 'network', totalMs: 20 }))).toMatch(/No pudimos conectar/)
  })
})
