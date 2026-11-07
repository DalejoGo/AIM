import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type AutomationStepReport,
  AutomationStreamEvents,
  AutomationWebhookPayload,
  type Service,
} from '@aim/contracts'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixedCaptcha } from '../src/adapters/captcha'
import { httpN8n } from '../src/adapters/n8n'
import { issueAssistantSession } from '../src/assistant/session'
import { ADMIN_SCOPES, issueAccessToken } from '../src/auth/tokens'
import { createRun } from '../src/automation/repository'
import { MAX_HEALTH_CHECKS, SUBREQUEST_BUDGET } from '../src/automation/run'
import { CALLBACK_AUDIENCE, issueCallbackToken } from '../src/automation/token'
import { automationEvents, automationRuns, automationUsage } from '../src/db/schema'
import { SERVICE_LABELS } from '../src/leads/notify'
import { STATUS_TIMEOUT_MS } from '../src/routes/automation'
import { createTestContext, type TestContext, type TestOverrides, testEnv } from './helpers'

const ROOT = join(import.meta.dirname, '../../..')
const N8N = 'https://n8n.test'
const HEALTH_URL = `${N8N}/healthz/readiness`
const WEBHOOK_URL = `${N8N}/webhook/aim-lead-demo`

const LEAD = {
  name: 'Laura Pérez',
  company: 'Café La Montaña',
  email: 'laura@cafelamontana.co',
  service: 'automation',
  budget: '500-2000',
  timeline: 'month',
  message: 'Queremos que los pedidos de WhatsApp lleguen solos a una hoja y avisen al equipo.',
}

const ACCEPTED_FLOW: AutomationStepReport[] = [
  { step: 'received', data: { execution: '1042' } },
  {
    step: 'validated',
    data: {
      valid: true,
      checks: [
        { id: 'corporate_email', label: 'Correo corporativo', ok: true },
        { id: 'detail', label: 'Mensaje con detalle', ok: true },
        { id: 'company', label: 'Empresa indicada', ok: true },
        { id: 'links', label: 'Sin enlaces sospechosos', ok: true },
      ],
    },
  },
  {
    step: 'scored',
    data: {
      score: 75,
      tier: 'hot',
      factors: [
        { label: 'Presupuesto de 500 a 2000 USD', points: 15 },
        { label: 'Plazo de 1 a 2 meses', points: 15 },
        { label: 'Servicio de automatización', points: 20 },
        { label: 'Correo corporativo', points: 10 },
        { label: 'Mensaje de 80 caracteres o más', points: 15 },
      ],
    },
  },
  { step: 'routed', data: { route: 'call', label: 'Llamada', sla: 'Llamada en menos de 24 horas' } },
  {
    step: 'drafted',
    data: { subject: 'Laura, hablemos de tu automatización', body: 'Hola Laura,\n\nGracias por escribir.' },
  },
  { step: 'recorded', data: { reference: 'AIM-00000000' } },
  { step: 'done', data: { outcome: 'accepted' } },
]

const REJECTED_FLOW: AutomationStepReport[] = [
  { step: 'received', data: { execution: '1043' } },
  {
    step: 'validated',
    data: { valid: false, checks: [{ id: 'links', label: 'Sin enlaces sospechosos', ok: false }] },
  },
  { step: 'done', data: { outcome: 'rejected' } },
]

afterEach(() => {
  vi.restoreAllMocks()
})

interface FetchCall {
  url: string
  method: string
  body: unknown
}

type Answer = Response | 'network_error'

interface FakeN8nOptions {
  /** Answer to the n-th GET /healthz/readiness (from 1), which may wait on the request's signal. Default: 200 JSON. */
  health?: (n: number, signal: AbortSignal) => Answer | Promise<Answer>
  /** Answer to the webhook, after the flow ran. Default: 202. */
  webhook?: () => Answer | Promise<Answer>
  /**
   * What the flow reports to the edge before the webhook answers (each report moves the clock 100 ms first).
   * Reporting before answering keeps the run deterministic: the stream then finds every step on its first poll.
   */
  flow?: AutomationStepReport[]
  /** Runs inside each health check (e.g. moves the clock like a slow request). */
  onHealth?: () => void
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Harness {
  t: TestContext
  calls: FetchCall[]
  /** The edge's answer to each step the flow reported. */
  reports: number[]
  /** The webhook bodies n8n received. */
  payloads: unknown[]
}

/**
 * A test context whose n8n is the real HTTP adapter over a fake fetch: every call is recorded (the subrequest
 * budget) and the fake flow reports its steps through the real callback route, with the token it received.
 */
async function automationContext(
  options: FakeN8nOptions = {},
  overrides: TestOverrides = {},
): Promise<Harness> {
  const calls: FetchCall[] = []
  const reports: number[] = []
  const payloads: unknown[] = []
  let healthChecks = 0
  let t: TestContext | undefined

  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ url, method: init.method ?? 'GET', body })
    if (url === HEALTH_URL) {
      options.onHealth?.()
      const signal = init.signal ?? new AbortController().signal
      const answer = (await options.health?.(++healthChecks, signal)) ?? json(200, { status: 'ok' })
      if (answer === 'network_error') throw new TypeError('fetch failed')
      return answer
    }
    if (url === WEBHOOK_URL) {
      payloads.push(body)
      const { runId, callbackToken } = body as { runId: string; callbackToken: string }
      for (const report of options.flow ?? []) {
        if (!t) throw new Error('no context')
        t.clock.now = new Date(t.clock.now.getTime() + 100)
        const step =
          report.step === 'recorded' ? { ...report, data: { reference: reference(runId) } } : report
        reports.push((await callback(t, runId, step, callbackToken)).status)
      }
      const answer = (await options.webhook?.()) ?? json(202, { message: 'Workflow was started' })
      if (answer === 'network_error') throw new TypeError('fetch failed')
      return answer
    }
    return new Response('not found', { status: 404 })
  }

  t = await createTestContext({
    n8n: httpN8n({ baseUrl: `${N8N}/`, webhookPath: 'aim-lead-demo', fetch }),
    ...overrides,
    env: { AUTOMATION_N8N_URL: N8N, ...overrides.env },
  })
  return { t, calls, reports, payloads }
}

const reference = (runId: string) => `AIM-${runId.slice(0, 8).toUpperCase()}`

function startRun(
  t: TestContext,
  body: unknown = { turnstileToken: 'turnstile-token', lead: LEAD },
  ip?: string,
) {
  return t.request('/api/automation/runs', {
    method: 'POST',
    body: JSON.stringify(body),
    ...(ip ? { ip } : {}),
  })
}

function callback(
  t: TestContext,
  runId: string,
  body: unknown,
  token: string | null,
  init: { origin?: string | null } = { origin: null },
) {
  return t.request(`/api/automation/runs/${runId}/events`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
    ...init,
  })
}

interface StreamEvent {
  event: string
  data: Record<string, unknown>
}

/** The events of a run's SSE body (each checked against its contract) and how many keep-alive comments came. */
async function readRun(res: Response): Promise<{ events: StreamEvent[]; pings: number }> {
  const blocks = (await res.text()).split('\n\n').filter((block) => block.trim())
  const pings = blocks.filter((block) => block === ': ping').length
  const events = blocks
    .filter((block) => !block.startsWith(':'))
    .map((block) => {
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
  return { events, pings }
}

const names = (events: StreamEvent[]) =>
  events.map((e) => (e.event === 'step' ? `step:${e.data.step}` : e.event))
const healthCalls = (calls: FetchCall[]) => calls.filter((c) => c.url === HEALTH_URL).length
const webhookCalls = (calls: FetchCall[]) => calls.filter((c) => c.url === WEBHOOK_URL)

describe('POST /api/automation/runs', () => {
  it('wakes n8n, sends the webhook and streams the seven steps of an accepted lead', async () => {
    const { t, calls, reports, payloads } = await automationContext({ flow: ACCEPTED_FLOW })
    const started = t.clock.now.getTime()
    const res = await startRun(t)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('RateLimit-Remaining')).toBe('2')
    const { events } = await readRun(res)
    await t.settle()

    expect(names(events)).toEqual([
      'run',
      'started',
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
    expect(events.filter((e) => e.event === 'step').map((e) => e.data.atMs)).toEqual([
      100, 200, 300, 400, 500, 600, 700,
    ])
    expect(events[4]?.data).toEqual({ ...ACCEPTED_FLOW[2], atMs: 300 })
    expect(events[7]?.data).toEqual({ step: 'recorded', data: { reference: reference(runId) }, atMs: 600 })
    expect(events.at(-1)).toEqual({ event: 'done', data: { outcome: 'accepted', totalMs: 700 } })
    expect(reports).toEqual(Array(7).fill(204))

    // One health check and one webhook: two subrequests besides Turnstile and the database.
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${HEALTH_URL}`, `POST ${WEBHOOK_URL}`])
    expect(payloads).toHaveLength(1)
    const payload = AutomationWebhookPayload.parse(payloads[0])
    expect(payload).toEqual({
      runId,
      callbackToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
      lead: { ...LEAD, serviceTitle: 'Automatizaciones' },
    })
    expect(JSON.stringify(payloads[0])).not.toContain('turnstile-token')
    const claims = JSON.parse(Buffer.from(payload.callbackToken.split('.')[1] ?? '', 'base64url').toString())
    expect(claims).toMatchObject({ aud: CALLBACK_AUDIENCE, sub: runId })
    expect(claims.exp - claims.iat).toBe(300)
    expect(claims.iat * 1000).toBe(started)

    // The run keeps no lead data: its row is an id and a time; the steps live with it for an hour.
    expect(await t.db.select().from(automationRuns)).toEqual([{ id: runId, createdAt: new Date(started) }])
    expect(await t.db.select().from(automationEvents)).toHaveLength(7)
    const usage = await t.db.select().from(automationUsage)
    expect(usage).toHaveLength(1)
    expect(JSON.stringify(usage)).not.toContain('203.0.113.7')
    // The database connection was released only after the stream ended.
    expect(t.disposed.count).toBe(8)
  })

  it('streams a rejected lead: validated with valid false, then done', async () => {
    const { t } = await automationContext({ flow: REJECTED_FLOW })
    const { events } = await readRun(await startRun(t))

    expect(names(events)).toEqual(['run', 'started', 'step:received', 'step:validated', 'step:done', 'done'])
    expect(events[3]?.data).toMatchObject({ step: 'validated', data: { valid: false } })
    expect(events.at(-1)).toEqual({ event: 'done', data: { outcome: 'rejected', totalMs: 300 } })
  })

  it('drops keys the contract does not have before storing and streaming a step', async () => {
    const extra = [
      { step: 'received', data: { execution: '9', password: 'x' }, debug: true },
      { step: 'done', data: { outcome: 'accepted' } },
    ] as unknown as AutomationStepReport[]
    const { t } = await automationContext({ flow: extra })
    const { events } = await readRun(await startRun(t))

    expect(events[2]?.data).toEqual({ step: 'received', data: { execution: '9' }, atMs: 100 })
    const [row] = await t.db.select().from(automationEvents)
    expect(row?.data).toEqual({ execution: '9' })
  })

  it('says n8n is waking while /healthz is not ready (errors, HTML interstitial), then runs', async () => {
    const answers: Answer[] = [
      json(503, { error: 'starting' }),
      'network_error',
      new Response('<html>Service waking up</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
      json(200, { status: 'ok' }),
    ]
    const { t, calls } = await automationContext({
      health: (n) => answers[n - 1] ?? json(200, {}),
      flow: REJECTED_FLOW,
    })
    const { events } = await readRun(await startRun(t))

    expect(names(events)).toEqual([
      'run',
      'waking',
      'waking',
      'waking',
      'started',
      'step:received',
      'step:validated',
      'step:done',
      'done',
    ])
    expect(events.filter((e) => e.event === 'waking').map((e) => e.data.elapsedMs)).toEqual([0, 6000, 12000])
    expect(healthCalls(calls)).toBe(4)
    expect(webhookCalls(calls)).toHaveLength(1)
  })

  it('gives up with n8n_unreachable once the wake timeout passes, without calling the webhook', async () => {
    const { t, calls } = await automationContext({ health: () => json(503, {}) })
    const { events } = await readRun(await startRun(t))

    // Checks at 0, 6, …, 180 s: 31 of them; the last one lands on the timeout.
    expect(healthCalls(calls)).toBe(31)
    expect(webhookCalls(calls)).toEqual([])
    const waking = events.filter((e) => e.event === 'waking')
    expect(waking).toHaveLength(30)
    expect(waking.at(-1)?.data).toEqual({ elapsedMs: 174_000 })
    expect(events.at(-1)).toEqual({
      event: 'error',
      data: { code: 'n8n_unreachable', message: expect.stringContaining('no despertó a tiempo') },
    })
    expect(names(events)).not.toContain('started')
  })

  it('honours AUTOMATION_WAKE_TIMEOUT_SECONDS', async () => {
    const { t, calls } = await automationContext(
      { health: () => json(503, {}) },
      { env: { AUTOMATION_WAKE_TIMEOUT_SECONDS: 30 } },
    )
    const { events } = await readRun(await startRun(t))
    expect(healthCalls(calls)).toBe(6)
    expect(events.at(-1)?.data).toMatchObject({ code: 'n8n_unreachable' })
  })

  it.each([
    ['a long timeout', {}, 600],
    ['slow checks that time out', { onHealth: 'slow' }, 600],
    ['the default timeout', {}, 180],
  ] as const)('never spends more than the subrequest budget, with %s', async (_, extra, seconds) => {
    let t: TestContext | undefined
    const { t: context, calls } = await automationContext(
      {
        health: () => 'network_error',
        // A check that hangs until the adapter's 5 s timeout cuts it.
        ...('onHealth' in extra
          ? {
              onHealth: () => {
                if (t) t.clock.now = new Date(t.clock.now.getTime() + 5_000)
              },
            }
          : {}),
      },
      { env: { AUTOMATION_WAKE_TIMEOUT_SECONDS: seconds } },
    )
    t = context
    const { events } = await readRun(await startRun(context))

    expect(events.at(-1)?.data).toMatchObject({ code: 'n8n_unreachable' })
    // Turnstile + the database socket + these calls (the webhook included, had it been sent).
    expect(calls.length).toBeLessThanOrEqual(MAX_HEALTH_CHECKS)
    expect(2 + calls.length + 1).toBeLessThanOrEqual(SUBREQUEST_BUDGET)
    if (seconds === 600) expect(calls.length).toBe(MAX_HEALTH_CHECKS)
  })

  it.each([
    ['answers 500', () => json(500, { message: 'Error in workflow' })],
    ['answers 404 (no such webhook)', () => json(404, { message: 'not registered' })],
    ['answers 200 while n8n is still starting up', () => json(200, { message: 'n8n is starting up' })],
    ['cannot be reached', () => 'network_error' as const],
  ])('ends with n8n_unreachable when the webhook %s', async (_, webhook) => {
    const { t, calls } = await automationContext({ webhook })
    const { events } = await readRun(await startRun(t))

    expect(webhookCalls(calls)).toHaveLength(1)
    expect(names(events)).toEqual(['run', 'error'])
    expect(events[1]?.data).toEqual({
      code: 'n8n_unreachable',
      message: expect.stringContaining('n8n no aceptó la ejecución'),
    })
  })

  it('ends with timeout when the flow does not finish in 30 s, keeping the connection alive meanwhile', async () => {
    const { t } = await automationContext({ flow: [{ step: 'received', data: { execution: '1' } }] })
    const { events, pings } = await readRun(await startRun(t))

    expect(names(events)).toEqual(['run', 'started', 'step:received', 'error'])
    expect(events.at(-1)?.data).toEqual({ code: 'timeout', message: expect.stringContaining('a tiempo') })
    // Quiet from 0.1 s to 30 s: a ": ping" comment at 10.1 s and 20.1 s.
    expect(pings).toBe(2)
  })

  it('streams internal when the database fails mid-run', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { t } = await automationContext({
      webhook: async () => {
        await t.db.execute(sql`drop table automation_events cascade`)
        return json(202, {})
      },
    })
    const { events } = await readRun(await startRun(t))
    expect(names(events)).toEqual(['run', 'started', 'error'])
    expect(events.at(-1)?.data).toMatchObject({ code: 'internal' })
  })

  it('stops checking n8n and releases the request as soon as the visitor leaves', async () => {
    const { t, calls } = await automationContext({ health: () => json(503, {}) })
    const res = await startRun(t)
    const reader = res.body?.getReader()
    if (!reader) throw new Error('no body')
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('event: run')
    await reader.cancel()
    await t.settle()

    const after = calls.length
    expect(after).toBeLessThan(5)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls.length).toBe(after)
    expect(t.disposed.count).toBe(1)
  })

  it('deletes runs and their steps older than an hour when a new run starts', async () => {
    const { t } = await automationContext({ flow: REJECTED_FLOW })
    const old = await readRun(await startRun(t, undefined, '198.51.100.1'))
    const oldRun = old.events[0]?.data.runId
    t.clock.now = new Date(t.clock.now.getTime() + 40 * 60_000)
    const recent = await readRun(await startRun(t, undefined, '198.51.100.2'))
    const recentRun = recent.events[0]?.data.runId
    expect(await t.db.select().from(automationEvents)).toHaveLength(6)

    t.clock.now = new Date(t.clock.now.getTime() + 21 * 60_000)
    const latest = await readRun(await startRun(t, undefined, '198.51.100.3'))
    const latestRun = latest.events[0]?.data.runId

    const runs = (await t.db.select({ id: automationRuns.id }).from(automationRuns)).map((r) => r.id)
    expect(runs.sort()).toEqual([recentRun, latestRun].sort())
    expect(runs).not.toContain(oldRun)
    const events = await t.db.select({ runId: automationEvents.runId }).from(automationEvents)
    expect(new Set(events.map((e) => e.runId))).toEqual(new Set([recentRun, latestRun]))
  })

  describe('limits', () => {
    const quickFlow = { flow: [{ step: 'done', data: { outcome: 'rejected' } }] as AutomationStepReport[] }

    it('lets a visitor run it 3 times every 10 minutes, with RateLimit headers and Retry-After', async () => {
      const { t } = await automationContext(quickFlow)
      const remaining: (string | null)[] = []
      for (let i = 0; i < 3; i++) {
        const res = await startRun(t)
        expect(res.status).toBe(200)
        remaining.push(res.headers.get('RateLimit-Remaining'))
        await readRun(res)
        t.clock.now = new Date(t.clock.now.getTime() + 60_000)
      }
      expect(remaining).toEqual(['2', '1', '0'])

      const res = await startRun(t)
      expect(res.status).toBe(429)
      expect(await res.json()).toEqual({
        error: 'rate_limited',
        message: 'Ya ejecutaste la demo 3 veces hace poco. Vuelve a intentarlo en 7 minutos.',
      })
      // The first run (3 minutes ago) leaves the 10-minute window in 7 minutes.
      expect(res.headers.get('Retry-After')).toBe('420')
      expect(res.headers.get('RateLimit-Policy')).toBe('3;w=600')
      expect(res.headers.get('RateLimit-Limit')).toBe('3')
      expect(res.headers.get('RateLimit-Remaining')).toBe('0')
      expect(res.headers.get('RateLimit-Reset')).toBe('420')

      // Another visitor is not affected, and the window frees a run in time.
      const other = await startRun(t, undefined, '198.51.100.9')
      expect(other.status).toBe(200)
      await readRun(other)
      t.clock.now = new Date(t.clock.now.getTime() + 420_000)
      const again = await startRun(t)
      expect(again.status).toBe(200)
      await readRun(again)
    })

    it('stops everyone with 503 daily_limit once the daily cap is reached', async () => {
      const { t, calls } = await automationContext(quickFlow, { env: { AUTOMATION_DAILY_LIMIT: 2 } })
      await readRun(await startRun(t, undefined, '198.51.100.1'))
      t.clock.now = new Date(t.clock.now.getTime() + 60 * 60_000)
      await readRun(await startRun(t, undefined, '198.51.100.2'))
      const before = calls.length

      const res = await startRun(t, undefined, '198.51.100.3')
      expect(res.status).toBe(503)
      expect(await res.json()).toMatchObject({
        error: 'daily_limit',
        message: expect.stringContaining('23 horas'),
      })
      // The first run leaves the rolling 24 hours in 23 hours.
      expect(res.headers.get('Retry-After')).toBe(String(23 * 3600))
      expect(calls.length).toBe(before)
      expect(await t.db.select().from(automationUsage)).toHaveLength(2)

      t.clock.now = new Date(t.clock.now.getTime() + 23 * 3600_000)
      const later = await startRun(t, undefined, '198.51.100.3')
      expect(later.status).toBe(200)
      await readRun(later)
    })
  })

  describe('refusals before the stream', () => {
    it('answers 503 automation_unavailable without AUTOMATION_N8N_URL, whatever the body', async () => {
      const t = await createTestContext()
      for (const body of [{ turnstileToken: 't', lead: LEAD }, {}]) {
        const res = await startRun(t, body)
        expect(res.status).toBe(503)
        expect(await res.json()).toMatchObject({ error: 'automation_unavailable' })
      }
      expect(await t.db.select().from(automationUsage)).toEqual([])
    })

    it('answers 400 with the contract field errors', async () => {
      const { t, calls } = await automationContext()
      const res = await startRun(t, {
        turnstileToken: 'x',
        lead: { ...LEAD, email: 'laura', budget: 'mucho' },
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string; fields: Record<string, string[]> }
      expect(body.error).toBe('invalid_request')
      expect(Object.keys(body.fields).sort()).toEqual(['lead.budget', 'lead.email'])
      expect(body.fields['lead.email']?.[0]).toContain('correo válido')
      expect(calls).toEqual([])
    })

    it('answers 403 captcha_failed when Turnstile refuses the token, before touching the database', async () => {
      const { t, calls } = await automationContext({}, { captcha: fixedCaptcha(false) })
      const res = await startRun(t)
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ error: 'captcha_failed' })
      expect(calls).toEqual([])
      expect(await t.db.select().from(automationUsage)).toEqual([])
    })

    it('answers 503 captcha_unavailable when Turnstile cannot be reached', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const captcha = {
        verify: async () => {
          throw new Error('down')
        },
      }
      const { t } = await automationContext({}, { captcha })
      const res = await startRun(t)
      expect(res.status).toBe(503)
      expect(await res.json()).toMatchObject({ error: 'captcha_unavailable' })
    })

    it('refuses a run from another origin, or without one', async () => {
      const { t, calls } = await automationContext()
      for (const origin of ['https://evil.example', null]) {
        const res = await t.request('/api/automation/runs', {
          method: 'POST',
          body: JSON.stringify({ turnstileToken: 't', lead: LEAD }),
          origin,
        })
        expect(res.status).toBe(403)
        expect(await res.json()).toMatchObject({ error: 'forbidden_origin' })
      }
      expect(calls).toEqual([])
    })
  })
})

describe('GET /api/automation/status', () => {
  const status = (t: TestContext) => t.request('/api/automation/status', { origin: null })

  it('says disabled without AUTOMATION_N8N_URL, without calling anything', async () => {
    const t = await createTestContext()
    const res = await status(t)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ state: 'disabled' })
  })

  it('says ready after exactly one readiness check, with no Origin, Turnstile or limit', async () => {
    const { t, calls } = await automationContext({}, { captcha: fixedCaptcha(false) })
    for (let i = 0; i < 5; i++) {
      const res = await status(t)
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(await res.json()).toEqual({ state: 'ready' })
    }
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(Array(5).fill(`GET ${HEALTH_URL}`))
    expect(await t.db.select().from(automationUsage)).toEqual([])
  })

  it.each([
    ['answers 503', () => json(503, { status: 'error' })],
    [
      'shows the HTML page Render serves while it boots',
      () =>
        new Response('<html>Service waking up</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    ],
    ['answers 404', () => new Response('not found', { status: 404 })],
    ['cannot be reached', () => 'network_error' as const],
  ])('says waking when n8n %s', async (_, health) => {
    const { t, calls } = await automationContext({ health })
    expect(await (await status(t)).json()).toEqual({ state: 'waking' })
    expect(calls).toHaveLength(1)
  })

  it(`says waking when the check hangs, after about ${STATUS_TIMEOUT_MS} ms`, async () => {
    const { t, calls } = await automationContext({
      // A sleeping Render service holds the request while it boots: only the timeout ends it.
      health: (_, signal) =>
        new Promise<Answer>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    })
    const started = performance.now()
    const res = await status(t)
    const took = performance.now() - started
    expect(await res.json()).toEqual({ state: 'waking' })
    expect(took).toBeGreaterThanOrEqual(STATUS_TIMEOUT_MS - 100)
    expect(took).toBeLessThan(STATUS_TIMEOUT_MS + 1500)
    expect(calls).toHaveLength(1)
  })
})

describe('POST /api/automation/runs/:runId/events', () => {
  async function runWithToken(t: TestContext) {
    const runId = await createRun(t.db, t.clock.now)
    return { runId, token: await issueCallbackToken(testEnv.JWT_SECRET, runId, t.clock.now) }
  }

  const received = { step: 'received', data: { execution: '77' } }

  it('stores a step with a valid token and answers 204, with no Origin (server to server)', async () => {
    const t = await createTestContext()
    const { runId, token } = await runWithToken(t)
    const res = await callback(t, runId, received, token)

    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(await t.db.select().from(automationEvents)).toEqual([
      { runId, step: 'received', data: { execution: '77' }, at: t.clock.now },
    ])
  })

  it('does not care about Origin on this path: the token is the only credential', async () => {
    const t = await createTestContext()
    const { runId, token } = await runWithToken(t)
    const res = await callback(t, runId, received, token, { origin: 'https://n8n.example' })
    expect(res.status).toBe(204)
  })

  it('keeps sameOrigin on every other POST, including look-alike paths', async () => {
    const t = await createTestContext()
    const { runId, token } = await runWithToken(t)
    for (const path of [
      `/api/automation/runs/${runId}/events/extra`,
      `/api/automation/runs/${runId}/event`,
      '/api/automation/runs/not-a-uuid/events',
      `/api/automation/runs/${runId.toUpperCase()}/events`,
      `/api/automation/runs`,
      '/api/leads',
    ]) {
      const res = await t.request(path, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(received),
        origin: null,
      })
      expect(res.status, path).toBe(403)
    }
  })

  it('answers 401 with WWW-Authenticate for a missing, malformed, expired or foreign token', async () => {
    const t = await createTestContext()
    const { runId, token } = await runWithToken(t)
    const other = await runWithToken(t)
    const wrongKey = await issueCallbackToken('another-secret-another-secret-another!', runId, t.clock.now)
    const { token: admin } = await issueAccessToken(
      testEnv.JWT_SECRET,
      'admin@aim.test',
      ADMIN_SCOPES,
      t.clock.now,
    )
    const assistant = await issueAssistantSession(testEnv.JWT_SECRET, t.clock.now)

    const cases: [string, Record<string, string>][] = [
      ['no header', {}],
      ['another scheme', { authorization: `Basic ${token}` }],
      ['an empty bearer', { authorization: 'Bearer ' }],
      ['garbage', { authorization: 'Bearer not.a.jwt' }],
      ['the token of another run', { authorization: `Bearer ${other.token}` }],
      ['a token signed with another secret', { authorization: `Bearer ${wrongKey}` }],
      ['an admin access token', { authorization: `Bearer ${admin}` }],
      ['an assistant session', { authorization: `Bearer ${assistant}` }],
    ]
    for (const [name, headers] of cases) {
      const res = await t.request(`/api/automation/runs/${runId}/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify(received),
        origin: null,
      })
      expect(res.status, name).toBe(401)
      expect(res.headers.get('WWW-Authenticate'), name).toBe('Bearer error="invalid_token"')
      expect(await res.json(), name).toMatchObject({ error: 'invalid_token' })
    }

    t.clock.now = new Date(t.clock.now.getTime() + 5 * 60_000 + 1000)
    const expired = await callback(t, runId, received, token)
    expect(expired.status).toBe(401)
    expect(await t.db.select().from(automationEvents)).toEqual([])
  })

  it('refuses a token signed with JWT_SECRET itself instead of the derived key', async () => {
    const { SignJWT } = await import('jose')
    const t = await createTestContext()
    const { runId } = await runWithToken(t)
    const iat = Math.floor(t.clock.now.getTime() / 1000)
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'aim-automation-callback+jwt' })
      .setIssuer('aim-edge')
      .setAudience(CALLBACK_AUDIENCE)
      .setSubject(runId)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 300)
      .sign(new TextEncoder().encode(testEnv.JWT_SECRET))
    expect((await callback(t, runId, received, forged)).status).toBe(401)
  })

  it('checks the token before the body', async () => {
    const t = await createTestContext()
    const { runId } = await runWithToken(t)
    expect((await callback(t, runId, { step: 'nope' }, null)).status).toBe(401)
  })

  it.each([
    ['an unknown step', { step: 'sent', data: {} }],
    ['data of another step', { step: 'scored', data: { route: 'call', label: 'x', sla: 'y' } }],
    ['a score out of range', { step: 'scored', data: { score: 140, tier: 'hot', factors: [] } }],
    ['a subject over 160 characters', { step: 'drafted', data: { subject: 'x'.repeat(161), body: 'Hola' } }],
    ['a malformed reference', { step: 'recorded', data: { reference: 'AIM-123' } }],
    ['no body at all', null],
  ])('answers 400 for %s', async (_, body) => {
    const t = await createTestContext()
    const { runId, token } = await runWithToken(t)
    const res = await callback(t, runId, body, token)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_request' })
    expect(await t.db.select().from(automationEvents)).toEqual([])
  })

  it('answers 413 for an oversized body', async () => {
    const t = await createTestContext()
    const { runId, token } = await runWithToken(t)
    const res = await callback(
      t,
      runId,
      { step: 'drafted', data: { subject: 'x', body: 'x'.repeat(20_000) } },
      token,
    )
    expect(res.status).toBe(413)
  })

  it('answers 409 when a step is reported twice, keeping the first', async () => {
    const t = await createTestContext()
    const { runId, token } = await runWithToken(t)
    expect((await callback(t, runId, received, token)).status).toBe(204)
    const again = await callback(t, runId, { step: 'received', data: { execution: '78' } }, token)
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({ error: 'step_already_reported' })
    const rows = await t.db.select().from(automationEvents)
    expect(rows.map((r) => r.data)).toEqual([{ execution: '77' }])
  })

  it('answers 401 when the run no longer exists', async () => {
    const t = await createTestContext()
    const { runId, token } = await runWithToken(t)
    await t.db.delete(automationRuns)
    expect((await callback(t, runId, received, token)).status).toBe(401)
  })
})

describe('service names sent to n8n', () => {
  it('match the titles of apps/web/src/content/services', () => {
    const dir = join(ROOT, 'apps/web/src/content/services')
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const service = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Service
      expect(SERVICE_LABELS[service.id]).toBe(service.title)
    }
  })
})
