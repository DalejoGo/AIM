import { EMAIL_OTP_GRANT } from '@aim/contracts'
import { describe, expect, it } from 'vitest'
import {
  ApiRequestError,
  createApi,
  type Fetch,
  isSessionExpired,
  type Locks,
  messageForStatus,
  parseRetryAfter,
  REFRESH_LOCK,
  toApiError,
} from './api'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

interface Call {
  path: string
  method: string
  body: unknown
  credentials: RequestCredentials | undefined
}

/** A fake fetch that answers from a queue and records every call. Without `locks`, single-tab mode. */
function fakeFetch(...responses: (Response | Error)[]) {
  return fakeFetchWith(null, ...responses)
}

function fakeFetchWith(locks: Locks | null, ...responses: (Response | Error)[]) {
  const calls: Call[] = []
  const fetchImpl: Fetch = async (path, init) => {
    calls.push({
      path,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      credentials: init.credentials,
    })
    const next = responses.shift()
    if (!next) throw new Error(`Unexpected call to ${path}`)
    if (next instanceof Error) throw next
    return next
  }
  return { calls, api: createApi(fetchImpl, { locks }) }
}

/** An in-memory Web Locks stand-in: callbacks for the same lock run one after the other. */
function fakeLocks() {
  const taken: string[] = []
  let tail: Promise<unknown> = Promise.resolve()
  const locks: Locks = {
    request(name, callback) {
      taken.push(name)
      const run = tail.then(callback)
      tail = run.catch(() => undefined)
      return run
    },
  }
  return { locks, taken }
}

const principal = { sub: 'david@example.com', scope: ['leads:read', 'leads:write'], exp: 1_900_000_000 }
const token = { token_type: 'Bearer', expires_in: 900, scope: 'leads:read leads:write' }
const lead = {
  id: '6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f',
  createdAt: '2026-11-06T15:04:05.000Z',
  status: 'new',
  name: 'Ana',
  email: 'ana@example.com',
  phone: null,
  service: 'web',
  message: 'Quiero una página para mi negocio.',
  quote: null,
}

describe('toApiError', () => {
  it('keeps the message, code and fields of an ApiError body', async () => {
    const error = await toApiError(
      json(400, {
        error: 'invalid_request',
        message: 'Revisa los datos marcados e inténtalo de nuevo.',
        fields: { email: ['Invalid email address'] },
      }),
    )
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error.status).toBe(400)
    expect(error.code).toBe('invalid_request')
    expect(error.message).toBe('Revisa los datos marcados e inténtalo de nuevo.')
    expect(error.fields).toEqual({ email: ['Invalid email address'] })
  })

  it('reads Retry-After on rate limits', async () => {
    const error = await toApiError(
      json(429, { error: 'rate_limited', message: 'Espera 2 minutos.' }, { 'Retry-After': '120' }),
    )
    expect(error.retryAfter).toBe(120)
    expect(error.message).toBe('Espera 2 minutos.')
  })

  it('falls back to a Spanish message when the body is not an ApiError', async () => {
    const error = await toApiError(new Response('<h1>Bad gateway</h1>', { status: 502 }))
    expect(error.code).toBe('http_502')
    expect(error.fields).toEqual({})
    expect(error.message).toBe(messageForStatus(502))
  })

  it('uses Retry-After in the fallback message', async () => {
    const error = await toApiError(new Response('', { status: 429, headers: { 'Retry-After': '61' } }))
    expect(error.message).toContain('2 minutos')
  })
})

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates', () => {
    const now = Date.parse('2026-11-06T12:00:00Z')
    expect(parseRetryAfter('30', now)).toBe(30)
    expect(parseRetryAfter('Fri, 06 Nov 2026 12:01:30 GMT', now)).toBe(90)
    expect(parseRetryAfter('Fri, 06 Nov 2026 11:00:00 GMT', now)).toBe(0)
    expect(parseRetryAfter(null, now)).toBeNull()
    expect(parseRetryAfter('soon', now)).toBeNull()
  })
})

describe('createApi', () => {
  it('sends JSON with same-origin credentials and validates the answer', async () => {
    const { api, calls } = fakeFetch(json(201, { id: lead.id }))
    const submission = {
      name: 'Ana',
      email: 'ana@example.com',
      service: 'web' as const,
      message: 'Quiero una página.',
      consent: true as const,
      turnstileToken: 'token',
    }
    await expect(api.submitLead(submission)).resolves.toEqual({ id: lead.id })
    expect(calls).toEqual([
      { path: '/api/leads', method: 'POST', body: submission, credentials: 'same-origin' },
    ])
  })

  it('throws the API error with its fields', async () => {
    const { api } = fakeFetch(
      json(400, { error: 'invalid_request', message: 'Revisa los datos.', fields: { name: ['Too small'] } }),
    )
    const error = await api.requestCode({ email: 'a@b.co', turnstileToken: 't' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect((error as ApiRequestError).fields).toEqual({ name: ['Too small'] })
  })

  it('reports a network failure as status 0', async () => {
    const { api } = fakeFetch(new TypeError('Failed to fetch'))
    const error = (await api.me().catch((e: unknown) => e)) as ApiRequestError
    expect(error.status).toBe(0)
    expect(error.code).toBe('network_error')
    expect(error.message).toBe(messageForStatus(0))
  })

  it('rejects a 2xx body that breaks the contract', async () => {
    const { api } = fakeFetch(json(200, { sub: '', scope: 'everything' }))
    await expect(api.me()).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('sends the e-mail code grant', async () => {
    const { api, calls } = fakeFetch(json(200, token))
    await api.signIn('david@example.com', '123456')
    expect(calls[0]?.body).toEqual({
      grant_type: EMAIL_OTP_GRANT,
      email: 'david@example.com',
      code: '123456',
    })
  })

  it('accepts an empty 204 on sign out', async () => {
    const { api } = fakeFetch(new Response(null, { status: 204 }))
    await expect(api.signOut()).resolves.toBeUndefined()
  })

  it('builds the lead list query without empty parameters', async () => {
    const { api, calls } = fakeFetch(
      json(200, { items: [lead], nextCursor: 'abc' }),
      json(200, { items: [], nextCursor: null }),
    )
    await api.listLeads({ status: 'won', cursor: 'abc', limit: 20 })
    await api.listLeads()
    expect(calls.map((c) => c.path)).toEqual([
      '/api/admin/leads?status=won&cursor=abc&limit=20',
      '/api/admin/leads',
    ])
  })
})

describe('admin calls after a 401', () => {
  const expired = () => json(401, { error: 'unauthorized', message: 'Tu sesión venció.' })

  it('refreshes once and retries once', async () => {
    const { api, calls } = fakeFetch(expired(), json(200, token), json(200, principal))
    await expect(api.me()).resolves.toEqual(principal)
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/auth/me',
      'POST /api/auth/token',
      'GET /api/auth/me',
    ])
    expect(calls[1]?.body).toEqual({ grant_type: 'refresh_token' })
  })

  it('repeats the body of the retried request', async () => {
    const { api, calls } = fakeFetch(expired(), json(200, token), json(200, { ...lead, status: 'won' }))
    await expect(api.updateLeadStatus(lead.id, 'won')).resolves.toMatchObject({ status: 'won' })
    expect(calls[2]).toMatchObject({
      method: 'PATCH',
      path: `/api/admin/leads/${lead.id}`,
      body: { status: 'won' },
    })
  })

  it('ends the session when the refresh is refused', async () => {
    const { api, calls } = fakeFetch(
      expired(),
      json(400, { error: 'invalid_grant', message: 'Tu sesión terminó.' }),
    )
    const error = await api.listLeads().catch((e: unknown) => e)
    expect(isSessionExpired(error)).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it('ends the session when the retry is still unauthorized, without a second refresh', async () => {
    const { api, calls } = fakeFetch(expired(), json(200, token), expired())
    const error = await api.listAudit().catch((e: unknown) => e)
    expect(isSessionExpired(error)).toBe(true)
    expect(calls.filter((c) => c.path === '/api/auth/token')).toHaveLength(1)
  })

  it('keeps the session when the refresh fails for lack of connection', async () => {
    const { api } = fakeFetch(expired(), new TypeError('Failed to fetch'))
    const error = await api.me().catch((e: unknown) => e)
    expect(isSessionExpired(error)).toBe(false)
    expect((error as ApiRequestError).status).toBe(0)
  })

  it('shares one refresh between parallel calls', async () => {
    const { api, calls } = fakeFetch(
      expired(),
      expired(),
      json(200, token),
      json(200, { items: [], nextCursor: null }),
      json(200, { items: [], nextCursor: null }),
    )
    await Promise.all([api.listLeads(), api.listAudit()])
    expect(calls.filter((c) => c.path === '/api/auth/token')).toHaveLength(1)
  })

  it('does not refresh on a 403', async () => {
    const { api, calls } = fakeFetch(
      json(403, { error: 'insufficient_scope', message: 'Tu cuenta no tiene permiso para esta acción.' }),
    )
    await expect(api.listAudit()).rejects.toMatchObject({ status: 403, code: 'insufficient_scope' })
    expect(calls).toHaveLength(1)
  })

  it('does not refresh public calls', async () => {
    const { api, calls } = fakeFetch(json(401, { error: 'unauthorized', message: 'No.' }))
    await expect(api.signIn('a@b.co', '000000')).rejects.toMatchObject({ status: 401 })
    expect(calls).toHaveLength(1)
  })
})

describe('admin calls after a 401, with the cross-tab lock', () => {
  const expired = () => json(401, { error: 'unauthorized', message: 'Tu sesión venció.' })
  const empty = () => json(200, { items: [], nextCursor: null })
  const renewals = (calls: Call[]) => calls.filter((c) => c.path === '/api/auth/token')

  it('renews once for two simultaneous 401s; the second call finds the session already renewed', async () => {
    const { locks, taken } = fakeLocks()
    const { api, calls } = fakeFetchWith(
      locks,
      expired(), // leads
      expired(), // audit
      expired(), // leads again, inside the lock: nobody renewed yet
      json(200, token), // the only renewal
      empty(), // leads after renewing
      empty(), // audit, inside the lock: already renewed
    )
    await expect(Promise.all([api.listLeads(), api.listAudit()])).resolves.toHaveLength(2)
    expect(renewals(calls)).toHaveLength(1)
    expect(taken).toEqual([REFRESH_LOCK, REFRESH_LOCK])
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/admin/leads',
      'GET /api/admin/audit',
      'GET /api/admin/leads',
      'POST /api/auth/token',
      'GET /api/admin/leads',
      'GET /api/admin/audit',
    ])
  })

  it('does not renew when another tab already did', async () => {
    const { locks } = fakeLocks()
    const { api, calls } = fakeFetchWith(locks, expired(), json(200, principal))
    await expect(api.me()).resolves.toEqual(principal)
    expect(renewals(calls)).toHaveLength(0)
  })

  it('ends the session when the renewal is refused', async () => {
    const { locks } = fakeLocks()
    const { api, calls } = fakeFetchWith(
      locks,
      expired(),
      expired(),
      json(400, { error: 'invalid_grant', message: 'Tu sesión terminó.' }),
    )
    const error = await api.listLeads().catch((e: unknown) => e)
    expect(isSessionExpired(error)).toBe(true)
    expect(calls).toHaveLength(3)
  })
})
