import { describe, expect, it } from 'vitest'
import { createTestContext } from './helpers'

describe('edge app', () => {
  it('answers health checks without touching the database', async () => {
    const t = await createTestContext()
    const res = await t.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects state-changing requests from another origin', async () => {
    const t = await createTestContext()
    const res = await t.request('/api/leads', { method: 'POST', body: '{}', origin: 'https://evil.test' })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'forbidden_origin' })
  })

  it('rejects state-changing requests without an Origin header', async () => {
    const t = await createTestContext()
    const res = await t.request('/api/leads', { method: 'POST', body: '{}', origin: null })
    expect(res.status).toBe(403)
  })

  it('answers 400, not 500, to a malformed JSON body', async () => {
    const t = await createTestContext()
    const res = await t.request('/api/leads', { method: 'POST', body: '{"name": ' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('answers unknown routes with an ApiError', async () => {
    const t = await createTestContext()
    const res = await t.request('/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'not_found' })
  })

  it('applies the migrations to a fresh database', async () => {
    const t = await createTestContext()
    const leads = await t.db.query.leads.findMany()
    expect(leads).toEqual([])
  })
})
