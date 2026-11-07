import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runLeadFlow } from '@aim/automations'
import { AutomationLead, AutomationStreamEvents, type Service } from '@aim/contracts'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixedCaptcha } from '../src/adapters/captcha'
import { INTERNAL_ERROR_MESSAGE, runEvents } from '../src/automation/run'
import { SERVICE_LABELS } from '../src/leads/notify'
import { createTestContext, type TestContext, type TestOverrides } from './helpers'

const ROOT = join(import.meta.dirname, '../../..')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const LEAD = {
  name: 'Laura Pérez',
  company: 'Café La Montaña',
  email: 'laura@cafelamontana.co',
  service: 'automation',
  budget: '500-2000',
  timeline: 'month',
  message: 'Queremos que los pedidos de WhatsApp lleguen solos a una hoja y avisen al equipo.',
}

/** Three links: more than the flow allows, so it rejects the lead right after validating it. */
const SPAM_LEAD = {
  ...LEAD,
  message: 'Mira https://ofertas-ya.com y http://clic.example/1 y también www.otro-sitio.net para más.',
}

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * A test context whose database factory throws and counts its calls: the demo must answer without ever opening
 * a connection (DEC-023), so a route that tried would fail the test.
 */
async function automationContext(overrides: TestOverrides = {}) {
  const opened = { count: 0 }
  const t = await createTestContext({
    db: async () => {
      opened.count++
      throw new Error('POST /api/automation/runs must not open the database')
    },
    ...overrides,
  })
  return { t, opened }
}

function startRun(t: TestContext, body: unknown = { turnstileToken: 'turnstile-token', lead: LEAD }) {
  return t.request('/api/automation/runs', { method: 'POST', body: JSON.stringify(body) })
}

interface StreamEvent {
  event: string
  data: Record<string, unknown>
}

/** The events of a run's SSE body, each checked against its contract. */
async function readRun(res: Response): Promise<StreamEvent[]> {
  const blocks = (await res.text()).split('\n\n').filter((block) => block.trim())
  return blocks.map((block) => {
    const lines = block.split('\n')
    const event = lines.find((l) => l.startsWith('event: '))?.slice(7) ?? ''
    const data = JSON.parse(
      lines
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('\n'),
    )
    const schema = AutomationStreamEvents[event as keyof typeof AutomationStreamEvents]
    expect(schema, `unknown event ${event}`).toBeDefined()
    expect(schema.safeParse(data).success, `${event} ${JSON.stringify(data)}`).toBe(true)
    return { event, data }
  })
}

const names = (events: StreamEvent[]) =>
  events.map((e) => (e.event === 'step' ? `step:${e.data.step}` : e.event))
const steps = (events: StreamEvent[]) => events.filter((e) => e.event === 'step').map((e) => e.data)
const withoutTime = ({ atMs: _, ...report }: Record<string, unknown>) => report
const flowLead = (lead: typeof LEAD) => ({ ...AutomationLead.parse(lead), serviceTitle: 'Automatizaciones' })

describe('POST /api/automation/runs', () => {
  it('runs the flow and streams the seven steps of an accepted lead', async () => {
    const { t, opened } = await automationContext()
    const res = await startRun(t)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('cache-control')).toBe('no-store')
    // No rate limit: Turnstile's single-use token is the guard.
    expect(res.headers.get('RateLimit-Policy')).toBeNull()
    const events = await readRun(res)

    expect(names(events)).toEqual([
      'run',
      'step:received',
      'step:validated',
      'step:scored',
      'step:routed',
      'step:drafted',
      'step:recorded',
      'step:done',
      'done',
    ])
    const runId = events[0]?.data.runId as string
    expect(runId).toMatch(UUID)
    // Exactly what the flow returns for this lead and run (the flow is parity-tested against n8n).
    expect(steps(events).map(withoutTime)).toEqual(runLeadFlow(flowLead(LEAD), runId))
    expect(steps(events)[0]).toEqual({
      step: 'received',
      data: { flow: 'Contacto → lead calificado' },
      atMs: 0,
    })
    expect(steps(events)[5]?.data).toEqual({ reference: `AIM-${runId.slice(0, 8).toUpperCase()}` })
    expect(events.at(-1)).toEqual({ event: 'done', data: { outcome: 'accepted', totalMs: 0 } })
    expect(opened.count).toBe(0)
  })

  it('streams a rejected lead: validated with valid false, then done', async () => {
    const { t } = await automationContext()
    const events = await readRun(await startRun(t, { turnstileToken: 'turnstile-token', lead: SPAM_LEAD }))

    expect(names(events)).toEqual(['run', 'step:received', 'step:validated', 'step:done', 'done'])
    const validated = steps(events)[1]?.data as { valid: boolean; checks: { id: string; ok: boolean }[] }
    expect(validated.valid).toBe(false)
    expect(validated.checks.find((c) => c.id === 'no_suspicious_links')?.ok).toBe(false)
    const runId = events[0]?.data.runId as string
    expect(steps(events).map(withoutTime)).toEqual(runLeadFlow(flowLead(SPAM_LEAD), runId))
    expect(events.at(-1)).toEqual({ event: 'done', data: { outcome: 'rejected', totalMs: 0 } })
  })

  it('times the flow with the injected clock: every step at the time the whole flow took', async () => {
    const { t } = await automationContext()
    // Each reading of the clock is 7 ms after the previous one.
    let ms = t.clock.now.getTime()
    Object.defineProperty(t.clock, 'now', {
      get: () => {
        ms += 7
        return new Date(ms)
      },
    })
    const events = await readRun(await startRun(t))

    expect(steps(events).map((s) => s.atMs)).toEqual(Array(7).fill(7))
    expect(events.at(-1)?.data).toEqual({ outcome: 'accepted', totalMs: 7 })
  })

  it('never opens the database and keeps nothing of the lead', async () => {
    const { t, opened } = await automationContext()
    for (let i = 0; i < 6; i++) {
      const res = await startRun(t)
      expect(res.status).toBe(200)
      expect(names(await readRun(res)).at(-1)).toBe('done')
    }
    expect(opened.count).toBe(0)
    // Migration 0005 dropped the demo's tables: there is nowhere left to store a run.
    const result = await t.db.execute(
      sql`select table_name from information_schema.tables where table_name like 'automation%'`,
    )
    expect((result as unknown as { rows: unknown[] }).rows).toEqual([])
    expect(t.disposed.count).toBe(6)
  })

  it('streams internal when the run throws, and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { t } = await automationContext()
    // The clock times the flow, so it is the one dependency that can fail inside the run.
    Object.defineProperty(t.clock, 'now', {
      get: () => {
        throw new Error('the clock broke')
      },
    })
    const res = await startRun(t)

    expect(res.status).toBe(200)
    const events = await readRun(res)
    expect(names(events)).toEqual(['run', 'error'])
    expect(events[1]?.data).toEqual({ code: 'internal', message: INTERNAL_ERROR_MESSAGE })
    expect(error).toHaveBeenCalledWith(expect.stringContaining('the clock broke'))
  })

  describe('refusals before the stream', () => {
    it('answers 400 with the contract field errors', async () => {
      const verify = vi.fn(async () => true)
      const { t } = await automationContext({ captcha: { verify } })
      const res = await startRun(t, {
        turnstileToken: 'x',
        lead: { ...LEAD, email: 'laura', budget: 'mucho' },
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string; fields: Record<string, string[]> }
      expect(body.error).toBe('invalid_request')
      expect(Object.keys(body.fields).sort()).toEqual(['lead.budget', 'lead.email'])
      expect(body.fields['lead.email']?.[0]).toContain('correo válido')
      expect(verify).not.toHaveBeenCalled()
    })

    it('answers 413 for a body over 16 KB, before reading it or calling Turnstile', async () => {
      const verify = vi.fn(async () => true)
      const { t } = await automationContext({ captcha: { verify } })
      const res = await startRun(t, {
        turnstileToken: 'turnstile-token',
        lead: { ...LEAD, message: 'x'.repeat(17 * 1024) },
      })
      expect(res.status).toBe(413)
      expect(await res.json()).toMatchObject({ error: 'payload_too_large' })
      expect(verify).not.toHaveBeenCalled()
    })

    it('answers 403 captcha_failed when Turnstile refuses the token, without running the flow', async () => {
      const { t, opened } = await automationContext({ captcha: fixedCaptcha(false) })
      const res = await startRun(t)
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ error: 'captcha_failed' })
      expect(opened.count).toBe(0)
    })

    it('answers 503 captcha_unavailable when Turnstile cannot be reached', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const captcha = {
        verify: async () => {
          throw new Error('down')
        },
      }
      const { t, opened } = await automationContext({ captcha })
      const res = await startRun(t)
      expect(res.status).toBe(503)
      expect(await res.json()).toMatchObject({ error: 'captcha_unavailable' })
      expect(opened.count).toBe(0)
    })

    it('refuses a run from another origin, or without one', async () => {
      const verify = vi.fn(async () => true)
      const { t } = await automationContext({ captcha: { verify } })
      for (const origin of ['https://evil.example', null]) {
        const res = await t.request('/api/automation/runs', {
          method: 'POST',
          body: JSON.stringify({ turnstileToken: 't', lead: LEAD }),
          origin,
        })
        expect(res.status).toBe(403)
        expect(await res.json()).toMatchObject({ error: 'forbidden_origin' })
      }
      expect(verify).not.toHaveBeenCalled()
    })
  })
})

describe('the n8n endpoints are gone', () => {
  it('answers 404 to GET /api/automation/status', async () => {
    const { t } = await automationContext()
    const res = await t.request('/api/automation/status', { origin: null })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'not_found' })
  })

  it('keeps sameOrigin on POST /api/automation/runs/<uuid>/events, which no longer exists', async () => {
    const { t } = await automationContext()
    const path = `/api/automation/runs/${crypto.randomUUID()}/events`
    const init = { method: 'POST', body: JSON.stringify({ step: 'received', data: { flow: 'x' } }) }

    const serverToServer = await t.request(path, { ...init, origin: null })
    expect(serverToServer.status).toBe(403)
    expect(await serverToServer.json()).toMatchObject({ error: 'forbidden_origin' })
    const fromTheSite = await t.request(path, init)
    expect(fromTheSite.status).toBe(404)
  })
})

describe('runEvents', () => {
  it('sends an internal error instead of a step that breaks the contract', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const runId = crypto.randomUUID()
    // The service's name goes into a scoring factor's label, which the contract caps at 120 characters.
    const lead = { ...flowLead(LEAD), serviceTitle: 'x'.repeat(200) }
    expect(runEvents({ runId, lead, now: () => new Date() })).toEqual([
      { event: 'run', data: { runId } },
      { event: 'error', data: { code: 'internal', message: INTERNAL_ERROR_MESSAGE } },
    ])
    expect(error).toHaveBeenCalledOnce()
  })
})

describe('service names the flow shows', () => {
  it('match the titles of apps/web/src/content/services', () => {
    const dir = join(ROOT, 'apps/web/src/content/services')
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const service = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Service
      expect(SERVICE_LABELS[service.id]).toBe(service.title)
    }
  })
})
