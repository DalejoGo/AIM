import { describe, expect, it } from 'vitest'
import {
  explainError,
  formatDuration,
  headerValue,
  isApiError,
  parseCount,
  parseRetryAfter,
  parseServerTime,
  pickHeaders,
  readBody,
  readMeta,
  SHOWN_HEADERS,
  seconds,
  statusKind,
  statusText,
} from './response'

const NOW = Date.parse('2026-11-06T15:30:00Z')

/** The headers of a real 429 of the API, plus some JavaScript may not read from another origin. */
const RATE_LIMITED = new Headers({
  'Content-Type': 'application/json; charset=utf-8',
  'X-Response-Time': '0.8ms',
  'X-RateLimit-Limit': '60',
  'X-RateLimit-Remaining': '0',
  'X-RateLimit-Reset': '42',
  'Retry-After': '42',
  'Set-Cookie': 'x=1',
  ETag: 'W/"2e7"',
})

describe('pickHeaders and headerValue', () => {
  it('keep the shown headers that arrived, in a fixed order', () => {
    expect(pickHeaders(RATE_LIMITED)).toEqual([
      { name: 'content-type', value: 'application/json; charset=utf-8' },
      { name: 'x-response-time', value: '0.8ms' },
      { name: 'x-ratelimit-limit', value: '60' },
      { name: 'x-ratelimit-remaining', value: '0' },
      { name: 'x-ratelimit-reset', value: '42' },
      { name: 'retry-after', value: '42' },
    ])
    expect(pickHeaders(new Headers())).toEqual([])
    expect(SHOWN_HEADERS).toContain('location')
  })

  it('look values up without caring about case', () => {
    const lines = pickHeaders(new Headers({ Location: '/api/v1/tasks/1' }))
    expect(headerValue(lines, 'Location')).toBe('/api/v1/tasks/1')
    expect(headerValue(lines, 'retry-after')).toBeNull()
  })
})

describe('parsers', () => {
  it('parseCount reads non-negative integers only', () => {
    expect(['0', ' 59 ', '60'].map(parseCount)).toEqual([0, 59, 60])
    expect([null, '', '-1', '1.5', 'diez'].map(parseCount)).toEqual([null, null, null, null, null])
  })

  it('parseServerTime reads the ms the API sends', () => {
    expect(parseServerTime('1.2ms')).toBe(1.2)
    expect(parseServerTime(' 15ms ')).toBe(15)
    expect(parseServerTime('3.75')).toBe(3.75)
    expect(parseServerTime('0.5 MS')).toBe(0.5)
    expect([null, '', 'fast', '-1ms', '2s'].map(parseServerTime)).toEqual([null, null, null, null, null])
  })

  it('parseRetryAfter reads seconds or an HTTP date', () => {
    expect(parseRetryAfter('42', NOW)).toBe(42)
    expect(parseRetryAfter('Fri, 06 Nov 2026 15:30:30 GMT', NOW)).toBe(30)
    expect(parseRetryAfter('Fri, 06 Nov 2026 15:00:00 GMT', NOW)).toBe(0)
    expect(parseRetryAfter(null, NOW)).toBeNull()
    expect(parseRetryAfter('pronto', NOW)).toBeNull()
  })
})

describe('readMeta', () => {
  it('reads timings, the rate limit and Retry-After', () => {
    expect(readMeta(pickHeaders(RATE_LIMITED), NOW)).toEqual({
      serverMs: 0.8,
      limit: 60,
      remaining: 0,
      resetSeconds: 42,
      retryAfter: 42,
      location: null,
    })
  })

  it('leaves out what did not arrive', () => {
    expect(readMeta([], NOW)).toEqual({
      serverMs: null,
      limit: null,
      remaining: null,
      resetSeconds: null,
      retryAfter: null,
      location: null,
    })
  })
})

describe('readBody', () => {
  it('indents JSON', () => {
    expect(readBody('{"items":[],"nextCursor":null}')).toEqual({
      kind: 'json',
      value: { items: [], nextCursor: null },
      text: '{\n  "items": [],\n  "nextCursor": null\n}',
    })
  })

  it('keeps other text as it came and marks an empty body', () => {
    expect(readBody('<html>Bad gateway</html>')).toEqual({ kind: 'text', text: '<html>Bad gateway</html>' })
    expect(readBody('')).toEqual({ kind: 'empty' })
    expect(readBody('  ')).toEqual({ kind: 'empty' })
  })
})

describe('isApiError', () => {
  it('accepts the ApiError shape, with or without fields', () => {
    expect(isApiError({ error: 'not_found', message: 'No está.' })).toBe(true)
    expect(isApiError({ error: 'invalid_request', message: 'Revisa.', fields: { title: ['Corto.'] } })).toBe(
      true,
    )
  })

  it('rejects anything else', () => {
    for (const value of [
      null,
      'error',
      [],
      { error: '', message: 'x' },
      { error: 'x' },
      { error: 'x', message: 1 },
      { error: 'x', message: 'y', fields: ['a'] },
      { error: 'x', message: 'y', fields: { a: 'b' } },
      { error: 'x', message: 'y', fields: { a: [1] } },
      { error: 'x', message: 'y', fields: null },
    ]) {
      expect(isApiError(value), JSON.stringify(value)).toBe(false)
    }
  })
})

describe('status', () => {
  it('splits success from errors', () => {
    expect([200, 201, 204, 304].map(statusKind)).toEqual(['success', 'success', 'success', 'success'])
    expect([400, 404, 429, 500, 503].map(statusKind)).toEqual(['error', 'error', 'error', 'error', 'error'])
  })

  it('names each status in Spanish, with a fallback per class', () => {
    expect(statusText(201)).toBe('Creado')
    expect(statusText(204)).toBe('Sin contenido')
    expect(statusText(429)).toBe('Demasiadas peticiones')
    expect(statusText(299)).toBe('Correcto')
    expect(statusText(307)).toBe('Redirección')
    expect(statusText(418)).toBe('Error en la petición')
    expect(statusText(599)).toBe('Error del servidor')
  })
})

describe('formatDuration and seconds', () => {
  it('use ms below a second and s above, with a decimal comma', () => {
    expect(formatDuration(0.8)).toBe('0,8 ms')
    expect(formatDuration(1.25)).toBe('1,3 ms')
    expect(formatDuration(154.4)).toBe('154 ms')
    expect(formatDuration(999)).toBe('999 ms')
    expect(formatDuration(48_230)).toBe('48,2 s')
  })

  it('agree in number', () => {
    expect(seconds(1)).toBe('1 segundo')
    expect(seconds(42)).toBe('42 segundos')
  })
})

describe('explainError', () => {
  const context = { retryAfter: null, limit: null }

  it('is null for a success', () => {
    expect(explainError(200, readBody('{}'), context)).toBeNull()
    expect(explainError(204, readBody(''), context)).toBeNull()
  })

  it('lists each invalid field with its problems', () => {
    const body = readBody(
      JSON.stringify({
        error: 'invalid_request',
        message: 'Hay datos que no son válidos. Revisa los campos marcados.',
        fields: {
          title: ['El título debe tener al menos 3 caracteres.'],
          priority: ['La prioridad debe ser low, medium o high.'],
        },
      }),
    )
    const explanation = explainError(400, body, context)
    expect(explanation).toMatchObject({
      code: 'invalid_request',
      message: 'Hay datos que no son válidos. Revisa los campos marcados.',
      fields: [
        { field: 'title', problems: ['El título debe tener al menos 3 caracteres.'] },
        { field: 'priority', problems: ['La prioridad debe ser low, medium o high.'] },
      ],
    })
    expect(explanation?.advice).toMatch(/esquemas de validación/)
  })

  it('explains a 429 with the wait from Retry-After and the limit', () => {
    const body = readBody(
      '{"error":"rate_limited","message":"Hiciste demasiadas peticiones. Intenta de nuevo en 42 s."}',
    )
    const explanation = explainError(429, body, { retryAfter: 42, limit: 60 })
    expect(explanation?.code).toBe('rate_limited')
    expect(explanation?.advice).toBe(
      'La API acepta 60 peticiones por minuto desde cada conexión, para frenar el abuso. Espera 42 segundos (lo dice la cabecera Retry-After) y vuelve a intentarlo.',
    )
    expect(explainError(429, readBody(''), context)?.advice).toMatch(/un número limitado.*Espera un momento/)
  })

  it('has advice for each error code of the API', () => {
    for (const [status, code, pattern] of [
      [404, 'not_found', /Lista las tareas/],
      [409, 'sandbox_full', /Empezar de cero/],
      [413, 'payload_too_large', /menos datos/],
      [415, 'unsupported_media_type', /Content-Type: application\/json/],
      [405, 'method_not_allowed', /método/],
      [409, 'conflict', /estado actual/],
      [500, 'internal', /no es por tu petición/],
      [400, 'invalid_request', /Revisa la ruta/],
    ] as const) {
      const explanation = explainError(
        status,
        readBody(JSON.stringify({ error: code, message: 'Mensaje.' })),
        context,
      )
      expect(explanation?.advice, code).toMatch(pattern)
      expect(explanation?.fields, code).toEqual([])
    }
  })

  it('falls back on the status for unknown codes and bodies that are not an ApiError', () => {
    expect(explainError(400, readBody('{"error":"nuevo","message":"Algo nuevo."}'), context)).toMatchObject({
      code: 'nuevo',
      message: 'Algo nuevo.',
      advice: expect.stringMatching(/Revisa la ruta/),
    })
    expect(explainError(502, readBody('<html>Bad gateway</html>'), context)).toEqual({
      code: null,
      message: 'La API respondió 502 (Puerta de enlace incorrecta) sin el formato de error de siempre.',
      advice: 'El servidor no pudo responder. Inténtalo de nuevo en un momento.',
      fields: [],
    })
  })
})
