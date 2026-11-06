import { Lead, type LeadPage, type LeadStatus, type Scope } from '@aim/contracts'
import { desc, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { ACCESS_COOKIE, issueAccessToken } from '../src/auth/tokens'
import { auditLog, leads } from '../src/db/schema'
import { createTestContext, type TestContext, testEnv } from './helpers'

const ADMIN = 'admin@aim.test'
const ALL: Scope[] = ['leads:read', 'leads:write', 'audit:read']

async function bearer(t: TestContext, scopes: Scope[] = ALL) {
  const { token } = await issueAccessToken(testEnv.JWT_SECRET, ADMIN, scopes, t.clock.now)
  return { authorization: `Bearer ${token}` }
}

/** Inserts `count` leads one minute apart (the last one is the newest). */
async function seed(t: TestContext, count: number, status: LeadStatus = 'new') {
  const start = t.clock.now.getTime() - count * 60_000
  const rows = await t.db
    .insert(leads)
    .values(
      Array.from({ length: count }, (_, i) => ({
        createdAt: new Date(start + i * 60_000),
        status,
        name: `Contacto ${i}`,
        email: `c${i}@example.com`,
        service: 'web',
        message: 'Quiero una página web para mi negocio.',
        consentAt: new Date(start + i * 60_000),
        ipHash: 'hash',
      })),
    )
    .returning({ id: leads.id })
  return rows.map((r) => r.id)
}

async function list(t: TestContext, query = '', scopes: Scope[] = ALL) {
  const res = await t.request(`/api/admin/leads${query}`, { headers: await bearer(t, scopes) })
  return { res, body: (await res.json()) as LeadPage }
}

/** Follows nextCursor until the end and returns the ids in the order served. */
async function walk(t: TestContext, query: string) {
  const ids: string[] = []
  let cursor: string | null = null
  let pages = 0
  do {
    const suffix: string = cursor ? `&cursor=${cursor}` : ''
    const { res, body } = await list(t, `${query}${suffix}`)
    expect(res.status).toBe(200)
    ids.push(...body.items.map((item) => item.id))
    cursor = body.nextCursor
    pages++
  } while (cursor && pages < 50)
  return { ids, pages }
}

function b64url(text: string) {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function patch(t: TestContext, id: string, body: unknown, headers: Record<string, string>) {
  return t.request(`/api/admin/leads/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers })
}

describe('GET /api/admin/leads', () => {
  it('answers 401 without a token', async () => {
    const t = await createTestContext()
    const res = await t.request('/api/admin/leads')
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'unauthorized' })
  })

  it('answers 403 with a token without leads:read', async () => {
    const t = await createTestContext()
    const res = await t.request('/api/admin/leads', { headers: await bearer(t, ['audit:read']) })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'insufficient_scope' })
  })

  it('accepts the access token from its cookie', async () => {
    const t = await createTestContext()
    const { token } = await issueAccessToken(testEnv.JWT_SECRET, ADMIN, ['leads:read'], t.clock.now)
    const res = await t.request('/api/admin/leads', { headers: { cookie: `${ACCESS_COOKIE}=${token}` } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [], nextCursor: null })
  })

  it('lists 20 leads per page by default, newest first, as the Lead contract', async () => {
    const t = await createTestContext()
    const ids = await seed(t, 25)
    const newestFirst = [...ids].reverse()

    const first = await list(t)
    expect(first.res.status).toBe(200)
    expect(first.body.items.map((i) => i.id)).toEqual(newestFirst.slice(0, 20))
    expect(first.body.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
    for (const item of first.body.items) {
      expect(Lead.strict().parse(item)).toEqual(item)
      expect(item).not.toHaveProperty('ipHash')
      expect(item).not.toHaveProperty('consentAt')
    }

    const second = await list(t, `?cursor=${first.body.nextCursor}`)
    expect(second.body.items.map((i) => i.id)).toEqual(newestFirst.slice(20))
    expect(second.body.nextCursor).toBeNull()
  })

  it('pages with limit and breaks ties of created_at by id', async () => {
    const t = await createTestContext()
    const at = t.clock.now
    const rows = await t.db
      .insert(leads)
      .values(
        Array.from({ length: 5 }, (_, i) => ({
          createdAt: at,
          name: `Gemelo ${i}`,
          service: 'web',
          message: 'Cinco contactos en el mismo instante.',
          consentAt: at,
          ipHash: 'hash',
        })),
      )
      .returning({ id: leads.id })
    // Lowercase uuid strings sort like Postgres compares uuids.
    const expected = rows
      .map((r) => r.id)
      .sort()
      .reverse()

    const { ids, pages } = await walk(t, '?limit=2')
    expect(ids).toEqual(expected)
    expect(pages).toBe(3)
  })

  it('never skips rows whose created_at has microseconds', async () => {
    const t = await createTestContext()
    const at = (micros: string) => sql`${`2026-11-06T14:00:00.${micros}Z`}::timestamptz`
    const base = {
      name: 'Micro',
      service: 'web',
      message: 'Mensaje de prueba largo.',
      consentAt: t.clock.now,
      ipHash: 'hash',
    }
    const inserted = await t.db
      .insert(leads)
      .values([
        { ...base, createdAt: at('123456') },
        { ...base, createdAt: at('123400') },
        { ...base, createdAt: at('123000') },
      ])
      .returning({ id: leads.id })

    const { ids } = await walk(t, '?limit=1')
    expect(ids).toEqual(inserted.map((r) => r.id))
  })

  it('filters by status', async () => {
    const t = await createTestContext()
    await seed(t, 3, 'new')
    const won = await seed(t, 2, 'won')

    const { body } = await list(t, '?status=won')
    expect(body.items.map((i) => i.id).sort()).toEqual([...won].sort())
    expect(body.items.every((i) => i.status === 'won')).toBe(true)
  })

  it('pages within a status filter', async () => {
    const t = await createTestContext()
    await seed(t, 4, 'spam')
    const contacted = await seed(t, 5, 'contacted')

    const { ids } = await walk(t, '?status=contacted&limit=2')
    expect(ids).toEqual([...contacted].reverse())
  })

  describe('with invalid query parameters', () => {
    // Read-only requests: the cases share one database.
    let t: TestContext
    beforeAll(async () => {
      t = await createTestContext()
    })

    it.each([
      ['a limit above 100', '?limit=101', 'invalid_request'],
      ['a limit of 0', '?limit=0', 'invalid_request'],
      ['an unknown status', '?status=archived', 'invalid_request'],
      ['a tampered cursor', '?cursor=bm90LWEtY3Vyc29y', 'invalid_cursor'],
      [
        'a cursor with an impossible date',
        `?cursor=${b64url('2026-02-30T00:00:00.000000Z|00000000-0000-4000-8000-000000000000')}`,
        'invalid_cursor',
      ],
    ])('answers 400 for %s', async (_case, query, error) => {
      const { res, body } = await list(t, query)
      expect(res.status).toBe(400)
      expect(body).toMatchObject({ error })
    })
  })

  it('accepts the maximum limit of 100', async () => {
    const t = await createTestContext()
    await seed(t, 3)
    const { res, body } = await list(t, '?limit=100')
    expect(res.status).toBe(200)
    expect(body.items).toHaveLength(3)
  })
})

describe('PATCH /api/admin/leads/:id', () => {
  it('answers 401 without a token and 403 without leads:write', async () => {
    const t = await createTestContext()
    const [id = ''] = await seed(t, 1)

    expect((await patch(t, id, { status: 'won' }, {})).status).toBe(401)
    const forbidden = await patch(t, id, { status: 'won' }, await bearer(t, ['leads:read']))
    expect(forbidden.status).toBe(403)
    const [row] = await t.db.select().from(leads)
    expect(row?.status).toBe('new')
  })

  it('changes the status, returns the lead and audits who changed it', async () => {
    const t = await createTestContext()
    const [id = ''] = await seed(t, 1)

    const res = await patch(t, id, { status: 'contacted' }, await bearer(t, ['leads:write']))
    expect(res.status).toBe(200)
    const lead = Lead.parse(await res.json())
    expect(lead).toMatchObject({ id, status: 'contacted', name: 'Contacto 0' })

    const [row] = await t.db.select().from(leads)
    expect(row?.status).toBe('contacted')

    const audit = await t.db.select().from(auditLog)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      actor: ADMIN,
      action: 'lead.status_changed',
      outcome: 'ok',
      detail: { leadId: id, from: 'new', to: 'contacted' },
    })
    expect(audit[0]?.at).toEqual(t.clock.now)
    expect(audit[0]?.ipHash).toBeTruthy()
  })

  it('records the previous status of each change', async () => {
    const t = await createTestContext()
    const [id = ''] = await seed(t, 1)
    const auth = await bearer(t)

    await patch(t, id, { status: 'contacted' }, auth)
    t.clock.now = new Date(t.clock.now.getTime() + 1000)
    await patch(t, id, { status: 'won' }, auth)

    const audit = await t.db.select().from(auditLog).orderBy(desc(auditLog.at))
    expect(audit.map((a) => a.detail)).toEqual([
      { leadId: id, from: 'contacted', to: 'won' },
      { leadId: id, from: 'new', to: 'contacted' },
    ])
  })

  it('answers 404 for a lead that does not exist, without auditing', async () => {
    const t = await createTestContext()
    const res = await patch(t, crypto.randomUUID(), { status: 'won' }, await bearer(t))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'not_found' })
    expect(await t.db.select().from(auditLog)).toEqual([])
  })

  it('answers 400 for an id that is not a uuid', async () => {
    const t = await createTestContext()
    const res = await patch(t, 'not-a-uuid', { status: 'won' }, await bearer(t))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_id' })
  })

  it('answers 400 for an unknown status', async () => {
    const t = await createTestContext()
    const [id = ''] = await seed(t, 1)
    const res = await patch(t, id, { status: 'archived' }, await bearer(t))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; fields: Record<string, string[]> }
    expect(body.error).toBe('invalid_request')
    expect(body.fields).toHaveProperty('status')
  })
})
