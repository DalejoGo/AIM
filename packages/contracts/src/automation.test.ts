import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_STATUS_STATES,
  AUTOMATION_STEPS,
  AutomationDoneEvent,
  AutomationErrorEvent,
  AutomationLead,
  AutomationRunRequest,
  AutomationStatus,
  AutomationStepEvent,
  AutomationStepReport,
  AutomationStreamEvents,
  AutomationWakingEvent,
  AutomationWebhookPayload,
} from './index'

// docs/AUTOMATIZACION.md is the contract between the page, the edge and n8n: these tests pin its bounds.

const lead = {
  name: 'Laura Pérez',
  company: 'Café La Montaña',
  email: 'laura@cafelamontana.co',
  service: 'automation',
  budget: '500-2000',
  timeline: 'month',
  message: 'Queremos que los pedidos de WhatsApp lleguen solos a una hoja y avisen al equipo.',
}

const fields = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? []

describe('AutomationLead', () => {
  it('accepts the example of the protocol', () => {
    expect(AutomationLead.parse(lead)).toEqual(lead)
  })

  it('cleans the text before checking the limits', () => {
    const parsed = AutomationLead.parse({
      ...lead,
      name: '  Laura\u0000   Pérez \n',
      company: '   ',
      email: '  Laura@CafeLaMontana.CO ',
      message: '\r\nLínea uno\r\nLínea dos\u0007 con detalle\t ',
    })
    expect(parsed).toEqual({
      ...lead,
      name: 'Laura Pérez',
      company: undefined,
      email: 'laura@cafelamontana.co',
      message: 'Línea uno\nLínea dos con detalle',
    })
  })

  it('keeps the company optional', () => {
    const { company: _, ...rest } = lead
    expect(AutomationLead.safeParse(rest).success).toBe(true)
  })

  it.each([
    ['name', 'L'],
    ['name', 'x'.repeat(81)],
    ['company', 'x'.repeat(81)],
    ['email', 'laura'],
    ['email', `${'x'.repeat(110)}@empresa.co`],
    ['service', 'seo'],
    ['service', 'other'],
    ['budget', '100'],
    ['timeline', 'tomorrow'],
    ['message', 'Corto'],
    ['message', 'x'.repeat(1001)],
  ])('refuses %s = %j with a Spanish message', (field, value) => {
    const result = AutomationLead.safeParse({ ...lead, [field]: value })
    expect(result.success).toBe(false)
    expect(fields(result)).toEqual([field])
    expect(result.error?.issues[0]?.message).toMatch(/^(Escribe|El nombre|Elige|Cuenta)/)
  })

  it('accepts the bounds', () => {
    const edges = {
      ...lead,
      name: 'Al',
      company: 'x'.repeat(80),
      email: `${'x'.repeat(108)}@empresa.co`,
      message: 'x'.repeat(1000),
    }
    expect(edges.email).toHaveLength(119)
    expect(AutomationLead.safeParse(edges).success).toBe(true)
    expect(
      AutomationLead.safeParse({ ...edges, name: 'x'.repeat(80), message: 'x'.repeat(10) }).success,
    ).toBe(true)
  })

  it('accepts every budget and timeline of the protocol', () => {
    for (const budget of ['lt500', '500-2000', '2000-5000', 'gt5000', 'unknown']) {
      expect(AutomationLead.safeParse({ ...lead, budget }).success).toBe(true)
    }
    for (const timeline of ['urgent', 'month', 'flexible']) {
      expect(AutomationLead.safeParse({ ...lead, timeline }).success).toBe(true)
    }
  })
})

describe('AutomationRunRequest', () => {
  it('needs a Turnstile token', () => {
    expect(AutomationRunRequest.safeParse({ turnstileToken: 'token', lead }).success).toBe(true)
    const missing = AutomationRunRequest.safeParse({ lead })
    expect(fields(missing)).toEqual(['turnstileToken'])
    expect(AutomationRunRequest.safeParse({ turnstileToken: '', lead }).success).toBe(false)
    expect(AutomationRunRequest.safeParse({ turnstileToken: 'x'.repeat(4097), lead }).success).toBe(false)
  })

  it('reports field errors under lead', () => {
    expect(
      fields(AutomationRunRequest.safeParse({ turnstileToken: 't', lead: { ...lead, email: 'no' } })),
    ).toEqual(['lead.email'])
  })
})

const REPORTS = {
  received: { execution: '1234' },
  validated: {
    valid: true,
    checks: [
      { id: 'corporate_email', label: 'Correo corporativo', ok: true },
      { id: 'no-spam-links', label: 'Sin enlaces sospechosos', ok: true },
    ],
  },
  scored: {
    score: 80,
    tier: 'hot',
    factors: [
      { label: 'Presupuesto 500–2000 USD', points: 15 },
      { label: 'Plazo de 1 a 2 meses', points: 15 },
    ],
  },
  routed: { route: 'call', label: 'Llamada', sla: 'Llamada en menos de 24 horas' },
  drafted: { subject: 'Laura, recibimos tu solicitud', body: 'Hola Laura,\n\nGracias por escribir.' },
  recorded: { reference: 'AIM-0B7C6A2E' },
  done: { outcome: 'accepted' },
} as const

describe('AutomationStepReport', () => {
  it('accepts each of the seven steps, in the order of the protocol', () => {
    expect(Object.keys(REPORTS)).toEqual([...AUTOMATION_STEPS])
    for (const step of AUTOMATION_STEPS) {
      expect(AutomationStepReport.parse({ step, data: REPORTS[step] })).toEqual({ step, data: REPORTS[step] })
    }
  })

  it('drops keys the protocol does not have', () => {
    const parsed = AutomationStepReport.parse({
      step: 'received',
      data: { execution: '7', secret: 'x' },
      extra: true,
    })
    expect(parsed).toEqual({ step: 'received', data: { execution: '7' } })
  })

  it.each([
    ['an unknown step', { step: 'sent', data: {} }],
    ['data of another step', { step: 'scored', data: REPORTS.routed }],
    ['a numeric execution', { step: 'received', data: { execution: 1234 } }],
    ['a score over 100', { step: 'scored', data: { ...REPORTS.scored, score: 101 } }],
    ['a fractional score', { step: 'scored', data: { ...REPORTS.scored, score: 70.5 } }],
    ['an unknown tier', { step: 'scored', data: { ...REPORTS.scored, tier: 'lukewarm' } }],
    ['an unknown route', { step: 'routed', data: { ...REPORTS.routed, route: 'email' } }],
    ['no checks', { step: 'validated', data: { valid: true, checks: [] } }],
    ['a subject over 160', { step: 'drafted', data: { ...REPORTS.drafted, subject: 'x'.repeat(161) } }],
    ['a body over 2000', { step: 'drafted', data: { ...REPORTS.drafted, body: 'x'.repeat(2001) } }],
    ['a lowercase reference', { step: 'recorded', data: { reference: 'AIM-0b7c6a2e' } }],
    ['a short reference', { step: 'recorded', data: { reference: 'AIM-0B7C' } }],
    ['an unknown outcome', { step: 'done', data: { outcome: 'maybe' } }],
    ['no data', { step: 'done' }],
  ])('refuses %s', (_, body) => {
    expect(AutomationStepReport.safeParse(body).success).toBe(false)
  })

  it('accepts the length limits of the preview', () => {
    const drafted = { subject: 'x'.repeat(160), body: 'x'.repeat(2000) }
    expect(AutomationStepReport.safeParse({ step: 'drafted', data: drafted }).success).toBe(true)
  })
})

describe('SSE events', () => {
  it('adds atMs to each step', () => {
    const event = { step: 'scored', data: REPORTS.scored, atMs: 812 }
    expect(AutomationStepEvent.parse(event)).toEqual(event)
    expect(AutomationStepEvent.safeParse({ ...event, atMs: -1 }).success).toBe(false)
    expect(AutomationStepEvent.safeParse({ step: 'scored', data: REPORTS.scored }).success).toBe(false)
  })

  it('describes waking, done and error', () => {
    expect(AutomationWakingEvent.parse({ elapsedMs: 6000 })).toEqual({ elapsedMs: 6000 })
    expect(AutomationDoneEvent.parse({ outcome: 'rejected', totalMs: 1500 })).toEqual({
      outcome: 'rejected',
      totalMs: 1500,
    })
    for (const code of ['n8n_unreachable', 'timeout', 'internal']) {
      expect(AutomationErrorEvent.safeParse({ code, message: 'Algo falló.' }).success).toBe(true)
    }
    expect(AutomationErrorEvent.safeParse({ code: 'other', message: 'x' }).success).toBe(false)
  })

  it('names a schema for every event of the stream', () => {
    expect(Object.keys(AutomationStreamEvents)).toEqual(['run', 'waking', 'started', 'step', 'done', 'error'])
    expect(
      AutomationStreamEvents.run.safeParse({ runId: '0b7c6a2e-5f1d-4c3a-9e8b-7a6d5c4b3a21' }).success,
    ).toBe(true)
    expect(AutomationStreamEvents.run.safeParse({ runId: 'run-1' }).success).toBe(false)
    expect(AutomationStreamEvents.started.parse({})).toEqual({})
  })
})

describe('AutomationWebhookPayload', () => {
  it('carries the run, its token and the lead with the service name', () => {
    const payload = {
      runId: '0b7c6a2e-5f1d-4c3a-9e8b-7a6d5c4b3a21',
      callbackToken: 'header.payload.signature',
      lead: { ...lead, serviceTitle: 'Automatizaciones' },
    }
    expect(AutomationWebhookPayload.parse(payload)).toEqual(payload)
    const { serviceTitle: _, ...withoutTitle } = payload.lead
    expect(AutomationWebhookPayload.safeParse({ ...payload, lead: withoutTitle }).success).toBe(false)
  })
})

describe('AutomationStatus', () => {
  it('is ready, waking or disabled', () => {
    expect([...AUTOMATION_STATUS_STATES]).toEqual(['ready', 'waking', 'disabled'])
    for (const state of AUTOMATION_STATUS_STATES) {
      expect(AutomationStatus.parse({ state })).toEqual({ state })
    }
    expect(AutomationStatus.safeParse({ state: 'asleep' }).success).toBe(false)
    expect(AutomationStatus.safeParse({}).success).toBe(false)
  })
})
