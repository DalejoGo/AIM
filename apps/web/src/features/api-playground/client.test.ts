import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Fetch, sendRequest } from './client'
import type { PreparedRequest } from './request'

const SANDBOX = '0b6e7d2a-3f4c-4b8e-9a1d-5c2f8e7a6b10'

const POST: PreparedRequest = {
  method: 'POST',
  path: '/api/v1/tasks',
  url: 'https://playground.test/api/v1/tasks',
  headers: [
    ['Content-Type', 'application/json'],
    ['X-Sandbox-Id', SANDBOX],
  ],
  body: '{"title":"Comprar pan"}',
}

const GET: PreparedRequest = { ...POST, method: 'GET', headers: [['X-Sandbox-Id', SANDBOX]], body: null }

/** A clock that moves only when told to. */
function manualClock(start = 1000) {
  let now = start
  return { clock: () => now, advance: (ms: number) => (now += ms) }
}

/** A fetch that never answers until its signal aborts, like a server that is still starting. */
const hangingFetch: Fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })

describe('sendRequest', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends method, headers and body without cookies or cache, and reads the whole answer', async () => {
    const time = manualClock()
    const calls: [string, RequestInit][] = []
    const fetchImpl: Fetch = async (input, init) => {
      calls.push([input, init])
      time.advance(120)
      return new Response('{"id":"1","title":"Comprar pan"}', {
        status: 201,
        headers: { 'X-Response-Time': '2.5ms', Location: '/api/v1/tasks/1', ETag: 'x' },
      })
    }

    const outcome = await sendRequest(POST, { fetchImpl, clock: time.clock })
    expect(outcome).toEqual({
      kind: 'response',
      status: 201,
      headers: [
        { name: 'content-type', value: 'text/plain;charset=UTF-8' },
        { name: 'x-response-time', value: '2.5ms' },
        { name: 'location', value: '/api/v1/tasks/1' },
      ],
      body: '{"id":"1","title":"Comprar pan"}',
      totalMs: 120,
    })
    const [url, init] = calls[0] ?? []
    expect(url).toBe('https://playground.test/api/v1/tasks')
    expect(init).toMatchObject({
      method: 'POST',
      headers: POST.headers,
      body: POST.body,
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
    })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('sends no body with GET and returns error statuses as answers', async () => {
    let sent: RequestInit | undefined
    const fetchImpl: Fetch = async (_input, init) => {
      sent = init
      return new Response('{"error":"rate_limited","message":"Espera."}', {
        status: 429,
        headers: { 'Retry-After': '42' },
      })
    }
    const outcome = await sendRequest(GET, { fetchImpl })
    expect(sent?.body).toBeUndefined()
    expect(outcome).toMatchObject({
      kind: 'response',
      status: 429,
      body: '{"error":"rate_limited","message":"Espera."}',
    })
    expect(outcome?.kind === 'response' && outcome.headers).toContainEqual({
      name: 'retry-after',
      value: '42',
    })
  })

  it('reads an empty 204', async () => {
    const outcome = await sendRequest(GET, { fetchImpl: async () => new Response(null, { status: 204 }) })
    expect(outcome).toMatchObject({ kind: 'response', status: 204, body: '' })
  })

  it('gives up after the timeout and reports how long it waited', async () => {
    const time = manualClock()
    const pending = sendRequest(GET, { fetchImpl: hangingFetch, timeoutMs: 75_000, clock: time.clock })
    time.advance(75_000)
    await vi.advanceTimersByTimeAsync(75_000)
    expect(await pending).toEqual({ kind: 'timeout', totalMs: 75_000 })
  })

  it('does not time out a slow answer that arrives in time', async () => {
    const fetchImpl: Fetch = () =>
      new Promise((resolve) => setTimeout(() => resolve(new Response('{}')), 50_000))
    const pending = sendRequest(GET, { fetchImpl, timeoutMs: 75_000 })
    await vi.advanceTimersByTimeAsync(50_000)
    expect(await pending).toMatchObject({ kind: 'response', status: 200 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports a network failure (no connection, CORS, DNS)', async () => {
    const fetchImpl: Fetch = async () => {
      throw new TypeError('Failed to fetch')
    }
    expect(await sendRequest(GET, { fetchImpl })).toMatchObject({ kind: 'network' })
  })

  it('returns null when the visitor cancels, before or during the request', async () => {
    const before = new AbortController()
    before.abort()
    const fetchImpl = vi.fn(hangingFetch)
    expect(await sendRequest(GET, { fetchImpl, signal: before.signal })).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()

    const during = new AbortController()
    const pending = sendRequest(GET, { fetchImpl: hangingFetch, signal: during.signal })
    await vi.advanceTimersByTimeAsync(5000)
    during.abort()
    expect(await pending).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
