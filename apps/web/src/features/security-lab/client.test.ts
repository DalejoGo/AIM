import { describe, expect, it } from 'vitest'
import { ApiRequestError } from '../../lib/api'
import type { BurstHit } from './burst'
import { BURST_PATH, runBurst } from './client'

const LIMIT = 10

const accepted = (remaining: number) =>
  new Response(JSON.stringify({ ok: true, remaining, resetInSeconds: 10 }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'RateLimit-Policy': `${LIMIT};w=10`,
      'RateLimit-Limit': String(LIMIT),
      'RateLimit-Remaining': String(remaining),
      'RateLimit-Reset': '10',
    },
  })

const rateLimited = (retryAfter: number) =>
  new Response(
    JSON.stringify({
      error: 'rate_limited',
      message: `Llegaste al límite de 10 peticiones cada 10 segundos. Vuelve a intentarlo en ${retryAfter} segundos.`,
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'RateLimit-Limit': String(LIMIT),
        'RateLimit-Remaining': '0',
        'RateLimit-Reset': String(retryAfter),
        'Retry-After': String(retryAfter),
      },
    },
  )

/** A fake API with a real-looking limit: LIMIT accepted, then 429. `reply` can override any request. */
function setup(reply?: (n: number) => Response | Promise<Response> | undefined) {
  const inits: RequestInit[] = []
  const paths: string[] = []
  let ticks = 0
  const seen: BurstHit[] = []
  const options = {
    onHit: (hit: BurstHit) => seen.push(hit),
    // Each request "takes" 12 ms on this clock.
    clock: () => (ticks++ % 2) * 12,
    fetchImpl: async (path: string, init: RequestInit) => {
      paths.push(path)
      inits.push(init)
      const n = paths.length
      return (await reply?.(n)) ?? (n <= LIMIT ? accepted(LIMIT - n) : rateLimited(10 - (n - LIMIT - 1)))
    },
  }
  return { options, paths, inits, seen }
}

describe('runBurst', () => {
  it('sends the requests one after the other and records every answer', async () => {
    const { options, paths, inits, seen } = setup()
    const run = await runBurst({ count: 15, ...options })

    expect(run.error).toBeNull()
    expect(paths).toEqual(Array(15).fill(BURST_PATH))
    expect(inits[0]).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'same-origin' })
    expect(run.hits).toEqual(seen)
    expect(run.hits.map((h) => h.n)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
    expect(run.hits.map((h) => h.status)).toEqual([...Array(10).fill(200), ...Array(5).fill(429)])
    expect(run.hits.map((h) => h.remaining)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0])
    expect(run.hits.map((h) => h.retryAfter)).toEqual([...Array(10).fill(null), 10, 9, 8, 7, 6])
    expect(run.hits.every((h) => h.ms === 12)).toBe(true)
  })

  it('keeps the rate-limit header lines of each answer as they arrived', async () => {
    const { options } = setup()
    const run = await runBurst({ count: 11, ...options })

    expect(run.hits[0]?.headers).toEqual([
      { name: 'RateLimit-Policy', value: '10;w=10' },
      { name: 'RateLimit-Limit', value: '10' },
      { name: 'RateLimit-Remaining', value: '9' },
      { name: 'RateLimit-Reset', value: '10' },
    ])
    expect(run.hits[10]?.headers.at(-1)).toEqual({ name: 'Retry-After', value: '10' })
  })

  it('reads the remaining count from the body when the header is missing', async () => {
    const { options } = setup(() => Response.json({ ok: true, remaining: 4, resetInSeconds: 3 }))
    const run = await runBurst({ count: 1, ...options })

    expect(run.hits[0]).toMatchObject({ status: 200, remaining: 4, headers: [] })
  })

  it('stops at a server error and returns its message', async () => {
    const { options, paths } = setup((n) =>
      n === 3
        ? Response.json(
            { error: 'internal', message: 'Algo falló de nuestro lado. Inténtalo de nuevo en unos minutos.' },
            { status: 500 },
          )
        : undefined,
    )
    const run = await runBurst({ count: 15, ...options })

    expect(paths).toHaveLength(3)
    expect(run.hits.map((h) => h.status)).toEqual([200, 200, 500])
    expect(run.error).toBeInstanceOf(ApiRequestError)
    expect(run.error).toMatchObject({ status: 500, code: 'internal' })
    expect(run.error?.message).toBe('Algo falló de nuestro lado. Inténtalo de nuevo en unos minutos.')
  })

  it('stops when the answer is not the API (a page instead of JSON)', async () => {
    const { options } = setup(() => new Response('<!doctype html>', { status: 200 }))
    const run = await runBurst({ count: 15, ...options })

    expect(run.hits).toHaveLength(1)
    expect(run.error).toMatchObject({ code: 'invalid_response' })
  })

  it('stops without connection and records the request that got no answer', async () => {
    const { options } = setup((n) => (n === 2 ? Promise.reject(new TypeError('Failed to fetch')) : undefined))
    const run = await runBurst({ count: 15, ...options })

    expect(run.hits.map((h) => h.status)).toEqual([200, 0])
    expect(run.error).toMatchObject({ status: 0, code: 'network_error' })
  })

  it('stops quietly when aborted', async () => {
    const controller = new AbortController()
    const { options, paths } = setup((n) => {
      if (n === 4) controller.abort()
      return undefined
    })
    const run = await runBurst({ count: 15, signal: controller.signal, ...options })

    expect(paths).toHaveLength(4)
    expect(run.hits).toHaveLength(3)
    expect(run.error).toBeNull()
  })
})
