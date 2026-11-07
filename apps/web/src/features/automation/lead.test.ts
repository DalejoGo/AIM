import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AutomationLead, AutomationRunRequest } from '@aim/contracts'
import { describe, expect, it } from 'vitest'
import {
  BUDGETS,
  EMPTY_FORM,
  FIELD_ORDER,
  fieldsFromApi,
  type LeadForm,
  leadErrors,
  MESSAGES,
  SAMPLE_LEADS,
  type ServiceOption,
  TIMELINES,
  toLead,
} from './lead'

const SERVICES: ServiceOption[] = readdirSync(join(import.meta.dirname, '../../content/services'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(join(import.meta.dirname, '../../content/services', file), 'utf8')))
  .map((service: { id: ServiceOption['id']; title: string }) => ({ id: service.id, title: service.title }))

const valid: LeadForm = {
  name: 'Laura Pérez',
  company: 'Café La Montaña',
  email: 'laura@cafelamontana.co',
  service: 'automation',
  budget: '500-2000',
  timeline: 'month',
  message: 'Queremos que los pedidos de WhatsApp lleguen solos a una hoja.',
}

/** The contract's message for one field of a lead (what the API would answer). */
function contractMessage(form: LeadForm, field: keyof LeadForm): string | undefined {
  const result = AutomationLead.safeParse(toLead(form))
  return result.error?.issues.find((issue) => issue.path[0] === field)?.message
}

describe('toLead', () => {
  it('cleans the fields as the contract does and leaves out an empty company', () => {
    const lead = toLead({
      ...valid,
      name: '  Laura \u0000  Pérez ',
      company: '   ',
      email: ' Laura@CafeLaMontana.CO ',
      message: '\r\n Hola\r\nequipo\u0007 \n',
    })
    expect(lead).toEqual({
      name: 'Laura Pérez',
      email: 'laura@cafelamontana.co',
      service: 'automation',
      budget: '500-2000',
      timeline: 'month',
      message: 'Hola\nequipo',
    })
    expect(AutomationLead.parse(toLead(valid))).toEqual(toLead(valid))
  })
})

describe('leadErrors', () => {
  it('accepts a valid lead, as the contract does', () => {
    expect(leadErrors(valid, SERVICES)).toEqual({})
    expect(AutomationRunRequest.safeParse({ turnstileToken: 't', lead: toLead(valid) }).success).toBe(true)
  })

  it('names every problem of an empty form, in the order of the form', () => {
    const errors = leadErrors(EMPTY_FORM, SERVICES)
    expect(Object.keys(errors)).toEqual(['name', 'email', 'service', 'message'])
    expect(FIELD_ORDER.filter((field) => errors[field])).toEqual(['name', 'email', 'service', 'message'])
  })

  it.each([
    ['name', 'L'],
    ['name', 'x'.repeat(81)],
    ['company', 'x'.repeat(81)],
    ['email', 'laura'],
    ['email', 'laura@empresa'],
    ['email', `${'x'.repeat(110)}@empresa.co`],
    ['service', 'seo'],
    ['message', 'Corto'],
    ['message', 'x'.repeat(1001)],
  ] as const)('refuses %s = %j with the words of the contract', (field, value) => {
    const form = { ...valid, [field]: value } as LeadForm
    expect(leadErrors(form, SERVICES)).toEqual({ [field]: MESSAGES[field] })
    expect(contractMessage(form, field)).toBe(MESSAGES[field])
  })

  it('has the contract message for budget and timeline too', () => {
    const form = { ...valid, budget: 'mucho', timeline: 'ayer' } as unknown as LeadForm
    expect(leadErrors(form, SERVICES)).toEqual({ budget: MESSAGES.budget, timeline: MESSAGES.timeline })
    expect(contractMessage(form, 'budget')).toBe(MESSAGES.budget)
    expect(contractMessage(form, 'timeline')).toBe(MESSAGES.timeline)
  })

  it('accepts the bounds', () => {
    const form = {
      ...valid,
      name: 'Al',
      company: 'x'.repeat(80),
      email: `${'x'.repeat(109)}@empresa.co`,
      message: 'x'.repeat(1000),
    }
    expect(form.email).toHaveLength(120)
    expect(leadErrors(form, SERVICES)).toEqual({})
    expect(AutomationLead.safeParse(toLead(form)).success).toBe(true)
  })

  it('offers every budget and timeline of the contract', () => {
    for (const { value } of BUDGETS) {
      expect(AutomationLead.safeParse({ ...toLead(valid), budget: value }).success).toBe(true)
    }
    for (const { value } of TIMELINES) {
      expect(AutomationLead.safeParse({ ...toLead(valid), timeline: value }).success).toBe(true)
    }
    expect(BUDGETS.every((b) => b.label.length > 0) && TIMELINES.every((t) => t.label.length > 0)).toBe(true)
  })
})

describe('fieldsFromApi', () => {
  it('maps the paths of a 400 to the form fields and ignores the rest', () => {
    expect(
      fieldsFromApi({
        'lead.email': ['Escribe un correo válido.'],
        'lead.message': ['Muy corto.', 'Otra'],
        turnstileToken: ['Completa la verificación.'],
        'lead.unknown': ['x'],
      }),
    ).toEqual({ email: 'Escribe un correo válido.', message: 'Muy corto.' })
  })
})

/** The flow's rules (docs/AUTOMATIZACION.md §3), to check that each example lands where it says. */
function expectedOutcome(form: LeadForm): 'hot' | 'warm' | 'cold' | 'rejected' {
  const lead = toLead(form)
  const links = lead.message.match(/https?:\/\//g)?.length ?? 0
  if (links > 2) return 'rejected'
  const budget = { lt500: 5, '500-2000': 15, '2000-5000': 25, gt5000: 35, unknown: 10 }[lead.budget]
  const timeline = { urgent: 20, month: 15, flexible: 5 }[lead.timeline]
  const service = lead.service === 'automation' || lead.service === 'app' ? 20 : 12
  const free = /@(gmail|hotmail|outlook|yahoo|icloud)\./.test(lead.email)
  const score = Math.min(
    100,
    budget + timeline + service + (free ? 0 : 10) + (lead.message.length >= 80 ? 15 : 0),
  )
  return score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold'
}

describe('SAMPLE_LEADS', () => {
  it('are valid leads that land in hot, warm and rejected', () => {
    expect(SAMPLE_LEADS.map((sample) => sample.id)).toEqual(['hot', 'warm', 'rejected'])
    for (const sample of SAMPLE_LEADS) {
      expect(leadErrors(sample.form, SERVICES), sample.id).toEqual({})
      expect(AutomationLead.safeParse(toLead(sample.form)).success, sample.id).toBe(true)
      expect(expectedOutcome(sample.form), sample.id).toBe(sample.id)
    }
  })
})
