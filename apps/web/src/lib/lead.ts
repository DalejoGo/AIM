import { LeadSubmission, type QuoteSnapshot } from '@aim/contracts'
import type { ApiRequestError } from './api'
import { normalizePhone } from './phone'

/**
 * Lead form rules shared by /contacto/ and the cotizador: the contract validates, this module turns its
 * issues (and the API's `fields`) into Spanish messages tied to each input.
 */

/** In the order they appear on screen, so the first error gets the focus. */
export const LEAD_FIELDS = [
  'name',
  'email',
  'phone',
  'service',
  'message',
  'consent',
  'turnstileToken',
] as const
export type LeadField = (typeof LEAD_FIELDS)[number]
export type LeadErrors = Partial<Record<LeadField, string>>

/** What the inputs hold before validation. */
export interface LeadDraft {
  name: string
  email: string
  phone: string
  service: string
  message: string
  consent: boolean
  turnstileToken: string | null
  quote?: QuoteSnapshot
}

export type LeadValidation = { ok: true; lead: LeadSubmission } | { ok: false; errors: LeadErrors }

export interface ServerProblem {
  errors: LeadErrors
  /** Message for the whole form, or null when the field messages say it all. */
  form: string | null
}

export const EMAIL_OR_PHONE = 'Déjame un correo o un teléfono para poder responderte.'
export const QUOTE_PROBLEM =
  'No pude leer el cálculo del cotizador. Recarga la página, vuelve a calcularlo y envíalo de nuevo.'

const isLeadField = (key: string | undefined): key is LeadField =>
  key !== undefined && (LEAD_FIELDS as readonly string[]).includes(key)

/** One message per field, saying how to fix it. `code` is the Zod issue code when it is known. */
export function leadFieldMessage(field: LeadField, code?: string): string {
  switch (field) {
    case 'name':
      return 'Escribe tu nombre, entre 2 y 80 caracteres.'
    case 'email':
      return code === 'custom' ? EMAIL_OR_PHONE : 'Revisa el correo: debe verse como nombre@dominio.com.'
    case 'phone':
      return 'Revisa el teléfono: escríbelo con el indicativo del país, por ejemplo +57 300 123 4567.'
    case 'service':
      return 'Elige un servicio de la lista.'
    case 'message':
      return code === 'too_big'
        ? 'Tu mensaje pasa de 2000 caracteres. Resúmelo un poco.'
        : 'Cuéntame un poco más: escribe al menos 10 caracteres.'
    case 'consent':
      return 'Para enviarlo, acepta la política de privacidad.'
    case 'turnstileToken':
      return 'Completa la verificación de seguridad antes de enviar.'
  }
}

/** Checks the draft with LeadSubmission. On success, `lead` is trimmed and the phone normalized. */
export function validateLead(draft: LeadDraft): LeadValidation {
  const candidate = {
    name: draft.name,
    email: draft.email.trim() || undefined,
    phone: normalizePhone(draft.phone),
    service: draft.service,
    message: draft.message,
    consent: draft.consent,
    turnstileToken: draft.turnstileToken ?? '',
    ...(draft.quote ? { quote: draft.quote } : {}),
  }
  const result = LeadSubmission.safeParse(candidate)
  const errors: LeadErrors = {}
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? '')
      if (isLeadField(key)) errors[key] ??= leadFieldMessage(key, issue.code)
    }
  }
  // Zod skips the "e-mail or phone" refinement while other fields fail; checking here shows every error at once.
  if (candidate.email === undefined && candidate.phone === undefined) errors.email = EMAIL_OR_PHONE
  if (result.success && Object.keys(errors).length === 0) return { ok: true, lead: result.data }
  return { ok: false, errors }
}

/**
 * Maps an API failure to the form. Field keys from the API are Zod paths with English messages,
 * so only the key is used and the Spanish message comes from leadFieldMessage.
 */
export function leadServerProblem(error: ApiRequestError): ServerProblem {
  if (error.code === 'captcha_failed') return { errors: { turnstileToken: error.message }, form: null }
  const errors: LeadErrors = {}
  let quote = false
  for (const key of Object.keys(error.fields)) {
    const field = key.split('.')[0]
    if (isLeadField(field)) errors[field] ??= leadFieldMessage(field)
    else if (field === 'quote') quote = true
  }
  return { errors, form: quote ? QUOTE_PROBLEM : error.message }
}

/** The first field with an error, in screen order. */
export function firstLeadError(errors: LeadErrors): LeadField | undefined {
  return LEAD_FIELDS.find((field) => errors[field] !== undefined)
}
