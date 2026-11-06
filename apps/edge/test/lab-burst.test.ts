import type { ApiError } from '@aim/contracts'
import { eq, ne } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { labHits } from '../src/db/schema'
import { decideBurst } from '../src/lab/burst'
import { createTestContext, type TestContext } from './helpers'

const IP = '203.0.113.7'
const OTHER_IP = '198.51.100.23'

function burst(t: TestContext, ip = IP) {
  // GET is a safe method: no Origin needed, as when the browser fetches it.
  return t.request('/api/lab/burst', { ip, origin: null })
}

const advance = (t: TestContext, ms: number) => {
  t.clock.now = new Date(t.clock.now.getTime() + ms)
}

const rateLimitHeaders = (res: Response) => ({
  limit: res.headers.get('RateLimit-Limit'),
  remaining: res.headers.get('RateLimit-Remaining'),
  reset: res.headers.get('RateLimit-Reset'),
})

/** Sends `n` requests one after the other, moving the clock `stepMs` after each one. */
async function sendMany(t: TestContext, n: number, stepMs = 0, ip = IP) {
  const responses: Response[] = []
  for (let i = 0; i < n; i++) {
    responses.push(await burst(t, ip))
    advance(t, stepMs)
  }
  return responses
}

describe('GET /api/lab/burst', () => {
  it('accepts 10 requests and counts down RateLimit-Remaining', async () => {
    const t = await createTestContext()
    const responses = await sendMany(t, 10)

    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(200))
    expect(await responses[0]?.json()).toEqual({ ok: true, remaining: 9, resetInSeconds: 10 })
    expect(await responses[9]?.json()).toEqual({ ok: true, remaining: 0, resetInSeconds: 10 })
    expect(responses.map((r) => rateLimitHeaders(r).remaining)).toEqual([
      '9',
      '8',
      '7',
      '6',
      '5',
      '4',
      '3',
      '2',
      '1',
      '0',
    ])
    const first = responses[0] as Response
    expect(rateLimitHeaders(first)).toEqual({ limit: '10', remaining: '9', reset: '10' })
    expect(first.headers.get('RateLimit-Policy')).toBe('10;w=10')
    expect(first.headers.get('Retry-After')).toBeNull()
    expect(first.headers.get('Cache-Control')).toBe('no-store')
  })

  it('answers the 11th with 429, an ApiError and Retry-After until the oldest request leaves the window', async () => {
    const t = await createTestContext()
    // One request every 400 ms: the first was accepted 4 s before the 11th.
    await sendMany(t, 10, 400)
    const res = await burst(t)

    expect(res.status).toBe(429)
    const body = (await res.json()) as ApiError
    expect(body.error).toBe('rate_limited')
    expect(body.message).toBe(
      'Llegaste al límite de 10 peticiones cada 10 segundos. Vuelve a intentarlo en 6 segundos.',
    )
    expect(res.headers.get('Retry-After')).toBe('6')
    expect(rateLimitHeaders(res)).toEqual({ limit: '10', remaining: '0', reset: '6' })
  })

  it('does not store rejected requests, so hammering does not push the wait further', async () => {
    const t = await createTestContext()
    await sendMany(t, 10)
    const rejected = await sendMany(t, 5, 1000)

    expect(rejected.map((r) => r.status)).toEqual(Array(5).fill(429))
    expect(rejected.map((r) => r.headers.get('Retry-After'))).toEqual(['10', '9', '8', '7', '6'])
    expect(await t.db.select().from(labHits)).toHaveLength(10)
  })

  it('lets requests through again as the clock moves past the window', async () => {
    const t = await createTestContext()
    await sendMany(t, 10, 1000)
    // The window now holds the requests sent at 0 s … 9 s and the clock is at 10 s: the first one just left.
    const freed = await burst(t)
    expect(freed.status).toBe(200)
    expect(await freed.json()).toEqual({ ok: true, remaining: 0, resetInSeconds: 1 })

    expect((await burst(t)).status).toBe(429)
    advance(t, 10_000)
    const later = await burst(t)
    expect(later.status).toBe(200)
    expect(rateLimitHeaders(later).remaining).toBe('9')
  })

  it('keeps every IP in its own window', async () => {
    const t = await createTestContext()
    await sendMany(t, 10)
    expect((await burst(t)).status).toBe(429)

    const other = await burst(t, OTHER_IP)
    expect(other.status).toBe(200)
    expect(rateLimitHeaders(other).remaining).toBe('9')
    expect((await burst(t)).status).toBe(429)
  })

  it("deletes the IP's rows older than the window on every hit, and only that IP's", async () => {
    const t = await createTestContext()
    await sendMany(t, 3)
    await sendMany(t, 2, 0, OTHER_IP)
    advance(t, 10_000)
    await burst(t)

    const [mine] = await t.db.select().from(labHits).where(eq(labHits.at, t.clock.now))
    expect(mine).toBeDefined()
    const rest = await t.db.select().from(labHits).where(ne(labHits.at, t.clock.now))
    // The other IP's two old rows wait for that IP's next request.
    expect(rest).toHaveLength(2)
    expect(rest.every((r) => r.ipHash !== mine?.ipHash)).toBe(true)
  })

  it('stores only the HMAC of the IP and the time', async () => {
    const t = await createTestContext()
    await burst(t)

    const [row] = await t.db.select().from(labHits)
    expect(row?.at).toEqual(t.clock.now)
    expect(row?.ipHash).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(JSON.stringify(row)).not.toContain(IP)
  })

  it('accepts exactly the limit when the requests arrive in parallel', async () => {
    const t = await createTestContext()
    const responses = await Promise.all(Array.from({ length: 15 }, () => burst(t)))
    const statuses = responses.map((r) => r.status)

    expect(statuses.filter((s) => s === 200)).toHaveLength(10)
    expect(statuses.filter((s) => s === 429)).toHaveLength(5)
    expect(await t.db.select().from(labHits)).toHaveLength(10)
  })

  it('reads the limit and the window from the environment', async () => {
    const t = await createTestContext({ env: { LAB_BURST_LIMIT: 3, LAB_BURST_WINDOW_SECONDS: 60 } })
    const responses = await sendMany(t, 4, 5000)

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 429])
    const last = responses[3] as Response
    expect(last.headers.get('RateLimit-Policy')).toBe('3;w=60')
    expect(last.headers.get('Retry-After')).toBe('45')
    expect(((await last.json()) as ApiError).message).toBe(
      'Llegaste al límite de 3 peticiones cada 60 segundos. Vuelve a intentarlo en 45 segundos.',
    )
  })

  it('answers 500 with an ApiError when the database fails', async () => {
    const t = await createTestContext()
    await t.db.execute('drop table lab_hits')
    const res = await burst(t)

    expect(res.status).toBe(500)
    expect(((await res.json()) as ApiError).error).toBe('internal')
  })
})

describe('decideBurst', () => {
  const policy = { limit: 10, windowSeconds: 10 }
  const now = Date.parse('2026-11-06T15:00:00Z')

  it('frees the slot of an empty window a whole window later', () => {
    expect(decideBurst(policy, { hits: 0, oldestMs: null }, now)).toEqual({
      allowed: true,
      limit: 10,
      remaining: 9,
      resetInSeconds: 10,
    })
  })

  it('rounds the wait up and never answers 0 seconds', () => {
    expect(decideBurst(policy, { hits: 10, oldestMs: now - 9_999 }, now)).toMatchObject({
      allowed: false,
      remaining: 0,
      resetInSeconds: 1,
    })
    expect(decideBurst(policy, { hits: 10, oldestMs: now - 2_500 }, now).resetInSeconds).toBe(8)
  })

  it('never waits longer than the window, even with a clock that went back', () => {
    expect(decideBurst(policy, { hits: 10, oldestMs: now + 60_000 }, now).resetInSeconds).toBe(10)
  })
})
