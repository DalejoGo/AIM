/**
 * The test lead the visitor sends to POST /api/automation/runs, checked before it leaves with the same rules
 * and words as the contract (AutomationLead in @aim/contracts), without zod: the island loads it lazily.
 */

import type { AutomationBudget, AutomationLeadInput, AutomationTimeline, ServiceId } from '@aim/contracts'
import { AUTOMATION_BUDGETS, AUTOMATION_LEAD_LIMITS, AUTOMATION_TIMELINES } from '@aim/contracts/limits'

const L = AUTOMATION_LEAD_LIMITS
export const LIMITS = L

export interface ServiceOption {
  id: ServiceId
  title: string
}

/** What the form holds: every field as the visitor typed it. */
export interface LeadForm {
  name: string
  company: string
  email: string
  service: ServiceId | ''
  budget: AutomationBudget
  timeline: AutomationTimeline
  message: string
}

export type LeadField = keyof LeadForm

export const EMPTY_FORM: LeadForm = {
  name: '',
  company: '',
  email: '',
  service: '',
  budget: 'unknown',
  timeline: 'month',
  message: '',
}

const BUDGET_LABELS: Record<AutomationBudget, string> = {
  lt500: 'Menos de 500 USD',
  '500-2000': 'De 500 a 2.000 USD',
  '2000-5000': 'De 2.000 a 5.000 USD',
  gt5000: 'Más de 5.000 USD',
  unknown: 'Aún no lo sé',
}

const TIMELINE_LABELS: Record<AutomationTimeline, string> = {
  urgent: 'En menos de 2 semanas',
  month: 'En 1 o 2 meses',
  flexible: 'Sin prisa',
}

export const BUDGETS = AUTOMATION_BUDGETS.map((value) => ({ value, label: BUDGET_LABELS[value] }))
export const TIMELINES = AUTOMATION_TIMELINES.map((value) => ({ value, label: TIMELINE_LABELS[value] }))

export const isBudget = (value: string): value is AutomationBudget =>
  (AUTOMATION_BUDGETS as readonly string[]).includes(value)
export const isTimeline = (value: string): value is AutomationTimeline =>
  (AUTOMATION_TIMELINES as readonly string[]).includes(value)

/** The contract's messages (packages/contracts/src/automation.ts); lead.test.ts checks they match. */
export const MESSAGES = {
  name: `Escribe un nombre de ${L.nameMin} a ${L.nameMax} caracteres.`,
  company: `El nombre de la empresa puede tener hasta ${L.companyMax} caracteres.`,
  email: 'Escribe un correo válido, por ejemplo laura@empresa.co.',
  service: 'Elige uno de los servicios de la lista.',
  budget: 'Elige un presupuesto de la lista.',
  timeline: 'Elige un plazo de la lista.',
  message: `Cuenta qué necesita el cliente en un mensaje de ${L.messageMin} a ${L.messageMax} caracteres.`,
} as const satisfies Record<LeadField, string>

// \p{Cc} = control characters, cleaned as the contract does.
const CONTROL = /\p{Cc}/gu
const CONTROL_BUT_LINE_BREAKS = /[^\P{Cc}\n\t]/gu
const cleanLine = (value: string) => value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
const cleanBlock = (value: string) =>
  value.replace(/\r\n?/g, '\n').replace(CONTROL_BUT_LINE_BREAKS, '').trim()

// The same shape zod checks (a dot in the domain and a TLD of letters); the API has the last word.
const EMAIL = /^(?!\.)(?!.*\.\.)[A-Za-z0-9_'+.-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/

/** The lead as the API will read it: cleaned, with an empty company left out. */
export function toLead(form: LeadForm): AutomationLeadInput {
  const company = cleanLine(form.company)
  return {
    name: cleanLine(form.name),
    ...(company ? { company } : {}),
    email: form.email.trim().toLowerCase(),
    service: form.service as ServiceId,
    budget: form.budget,
    timeline: form.timeline,
    message: cleanBlock(form.message),
  }
}

export type LeadErrors = Partial<Record<LeadField, string>>

/** Why each field cannot be sent as it is (empty when the lead is fine). */
export function leadErrors(form: LeadForm, services: readonly ServiceOption[]): LeadErrors {
  const lead = toLead(form)
  const errors: LeadErrors = {}
  if (lead.name.length < L.nameMin || lead.name.length > L.nameMax) errors.name = MESSAGES.name
  if ((lead.company?.length ?? 0) > L.companyMax) errors.company = MESSAGES.company
  if (lead.email.length > L.emailMax || !EMAIL.test(lead.email)) errors.email = MESSAGES.email
  if (!services.some((s) => s.id === lead.service)) errors.service = MESSAGES.service
  if (!isBudget(lead.budget)) errors.budget = MESSAGES.budget
  if (!isTimeline(lead.timeline)) errors.timeline = MESSAGES.timeline
  if (lead.message.length < L.messageMin || lead.message.length > L.messageMax)
    errors.message = MESSAGES.message
  return errors
}

/** The order of the fields in the form: the first one with an error takes the focus. */
export const FIELD_ORDER: readonly LeadField[] = [
  'name',
  'company',
  'email',
  'service',
  'budget',
  'timeline',
  'message',
]

/** Field errors of a 400 (`lead.email` → `email`), so they show under their inputs. */
export function fieldsFromApi(fields: Record<string, string[]>): LeadErrors {
  const errors: LeadErrors = {}
  for (const [path, messages] of Object.entries(fields)) {
    const field = path.replace(/^lead\./, '') as LeadField
    if (FIELD_ORDER.includes(field) && messages[0]) errors[field] = messages[0]
  }
  return errors
}

export interface SampleLead {
  id: 'hot' | 'warm' | 'rejected'
  /** What the visitor should expect, said before running it. */
  expect: string
  form: LeadForm
}

/**
 * Made-up leads, one per outcome of the flow's rules (docs/AUTOMATIZACION.md): hot (score ≥ 70), warm (40–69)
 * and rejected (more than 2 links in the message). Domains are reserved for examples (RFC 2606) or a free mail
 * provider, so nobody real gets written to, and the reply is never sent anyway.
 */
export const SAMPLE_LEADS: readonly SampleLead[] = [
  {
    id: 'hot',
    expect: 'Cliente con prioridad alta',
    form: {
      name: 'Laura Pérez',
      company: 'Café La Montaña',
      email: 'laura@cafelamontana.example',
      service: 'automation',
      budget: '500-2000',
      timeline: 'urgent',
      message:
        'Queremos que los pedidos que llegan por WhatsApp pasen solos a una hoja de cálculo y que el equipo reciba un aviso con cada pedido nuevo.',
    },
  },
  {
    id: 'warm',
    expect: 'Cliente con prioridad media',
    form: {
      name: 'Andrés Rojas',
      company: 'Taller Rojas',
      email: 'andres.rojas@gmail.com',
      service: 'web',
      budget: '2000-5000',
      timeline: 'flexible',
      message: 'Necesito una página para mostrar los servicios de mi taller mecánico.',
    },
  },
  {
    id: 'rejected',
    expect: 'Solicitud rechazada por enlaces sospechosos',
    form: {
      name: 'Oferta Express',
      company: '',
      email: 'ventas@ofertas-express.example',
      service: 'content',
      budget: 'unknown',
      timeline: 'urgent',
      message: 'Gana dinero desde casa: http://promo.example/a http://promo.example/b http://promo.example/c',
    },
  },
]
