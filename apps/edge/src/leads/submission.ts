import { LeadSubmission } from '@aim/contracts'
import { zValidator } from '@hono/zod-validator'
import type { Db } from '../deps'
import { fail } from '../lib/http'
import { type NewLead, recentLeadsFromIp } from './repository'

// Rules of POST /api/leads that are not HTTP: cleaning, field messages, the row to store and the rate limit.

export const LEADS_PER_IP_PER_HOUR = 5
const WINDOW_MS = 60 * 60 * 1000

/** Spanish message per field of the form, saying what to fix (Zod's defaults are English and generic). */
const FIELD_MESSAGES: Record<string, string> = {
  name: 'Escribe tu nombre, entre 2 y 80 caracteres.',
  email: 'Escribe un correo válido, por ejemplo nombre@empresa.com.',
  phone: 'Escribe el teléfono solo con números e incluye el indicativo del país, por ejemplo 573001234567.',
  service: 'Elige uno de los servicios de la lista.',
  message: 'Cuéntanos qué necesitas en un mensaje de 10 a 2000 caracteres.',
  consent: 'Acepta la política de privacidad para que podamos contactarte.',
  turnstileToken: 'Completa la verificación de seguridad antes de enviar el formulario.',
  quote: 'La cotización adjunta no es válida. Vuelve a calcularla en el cotizador.',
}
const CONTACT_MISSING = 'Déjanos un correo o un teléfono para poder responderte.'
const FALLBACK = 'Revisa este dato.'

interface Issue {
  code: string
  path: readonly PropertyKey[]
}

export function fieldMessages(issues: readonly Issue[]): Record<string, string[]> {
  const fields: Record<string, string[]> = {}
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_'
    const field = String(issue.path[0] ?? '')
    // The contract's "email or phone" refinement reports on `email` with a custom issue.
    const message =
      field === 'email' && issue.code === 'custom' ? CONTACT_MISSING : (FIELD_MESSAGES[field] ?? FALLBACK)
    const list = fields[key] ?? []
    if (!list.includes(message)) list.push(message)
    fields[key] = list
  }
  return fields
}

// \p{Cc} = control characters. Postgres rejects NUL in text and the rest only hide content.
const CONTROL = /\p{Cc}/gu
const CONTROL_BUT_LINE_BREAKS = /[^\P{Cc}\n\t]/gu

/** One line, single spaces. */
function cleanLine(value: string): string {
  return value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
}

/** Keeps line breaks (the message is free text). */
function cleanBlock(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(CONTROL_BUT_LINE_BREAKS, '').trim()
}

/** Cleans the raw body before the contract validates it, so limits apply to what is stored. */
export function cleanSubmission(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
  const body: Record<string, unknown> = { ...raw }
  if (typeof body.name === 'string') body.name = cleanLine(body.name)
  if (typeof body.email === 'string') body.email = body.email.trim().toLowerCase()
  if (typeof body.phone === 'string') body.phone = body.phone.trim()
  if (typeof body.message === 'string') body.message = cleanBlock(body.message)
  return body
}

/** Validates the JSON body against the contract after cleaning it; 400 with Spanish messages per field. */
export const validLeadSubmission = zValidator(
  'json',
  LeadSubmission,
  (result, c) => {
    if (result.success) return
    return fail(
      c,
      400,
      'invalid_request',
      'Revisa los datos marcados e inténtalo de nuevo.',
      fieldMessages(result.error.issues),
    )
  },
  { validationFunction: (schema, value) => schema.safeParse(cleanSubmission(value)) },
)

/** The row to store. Built field by field: the Turnstile token and the IP never reach the database. */
export function toNewLead(input: LeadSubmission, ipHash: string, now: Date): NewLead {
  return {
    createdAt: now,
    name: input.name,
    email: input.email ?? null,
    phone: input.phone ?? null,
    service: input.service,
    message: input.message,
    quote: input.quote ?? null,
    consentAt: now,
    ipHash,
  }
}

/** Seconds until this IP may send another lead, or null if it is under the limit. */
export async function leadRetryAfter(db: Db, ipHash: string, now: Date): Promise<number | null> {
  const { count, oldest } = await recentLeadsFromIp(db, ipHash, new Date(now.getTime() - WINDOW_MS))
  if (count < LEADS_PER_IP_PER_HOUR) return null
  const freesAt = (oldest?.getTime() ?? now.getTime()) + WINDOW_MS
  return Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000))
}
