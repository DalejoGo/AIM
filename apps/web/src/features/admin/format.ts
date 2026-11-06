import type { AuditEntry, LeadStatus, QuoteConfig, QuoteSnapshot } from '@aim/contracts'
import { formatMoney } from '../../lib/money'

// Pure helpers of the /admin/ panel: labels, dates and links. Type-only contract imports.

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  won: 'Ganado',
  lost: 'Perdido',
  spam: 'Spam',
}

/** In the order of the select: the lifecycle of a lead, then spam. */
export const STATUS_ORDER = Object.keys(STATUS_LABELS) as LeadStatus[]

export const OUTCOME_LABELS: Record<AuditEntry['outcome'], string> = {
  ok: 'Correcto',
  denied: 'Denegado',
  error: 'Error',
}

/** Actions written by apps/edge; an unknown one is shown as it comes. */
const ACTION_LABELS: Record<string, string> = {
  'auth.code_requested': 'Pidió un código',
  'auth.login': 'Entró con un código',
  'auth.rate_limited': 'Superó el límite de intentos',
  'auth.refresh': 'Renovó la sesión',
  'auth.refresh_reuse': 'Usó una sesión ya renovada',
  'auth.logout': 'Cerró la sesión',
  'lead.status_changed': 'Cambió el estado de un contacto',
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

/** Names the panel needs to read a quote snapshot, built at compile time from content. */
export interface Catalog {
  services: Record<string, string>
  /** service id → option id → label */
  options: Record<string, Record<string, string>>
  timelines: Record<string, string>
}

export function buildCatalog(
  services: readonly { id: string; title: string }[],
  quote: QuoteConfig,
): Catalog {
  return {
    services: Object.fromEntries(services.map((s) => [s.id, s.title])),
    options: Object.fromEntries(
      quote.services.map((s) => [s.service, Object.fromEntries(s.options.map((o) => [o.id, o.label]))]),
    ),
    timelines: Object.fromEntries(quote.timelines.map((t) => [t.id, t.label])),
  }
}

export function serviceLabel(catalog: Catalog, id: string): string {
  return catalog.services[id] ?? id
}

export interface QuoteDescription {
  range: string
  timeline: string
  options: string[]
}

/** The snapshot in words. Ids missing from the catalog (an option removed since) are shown as they are. */
export function describeQuote(quote: QuoteSnapshot, catalog: Catalog): QuoteDescription {
  const labels = catalog.options[quote.service] ?? {}
  const low = formatMoney(quote.min, quote.currency)
  const range = quote.min === quote.max ? low : `${low} a ${formatMoney(quote.max, quote.currency)}`
  return {
    range: `${range} ${quote.currency}`,
    timeline: catalog.timelines[quote.timeline] ?? quote.timeline,
    options: quote.options.map((id) => labels[id] ?? id),
  }
}

const dateTime = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/** "6 de nov de 2026, 10:04 a. m." in the reader's time zone. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateTime.format(date)
}

/** wa.me link for a stored phone (digits, international), or null if it does not look like one. */
export function phoneLink(phone: string): string | null {
  return /^\d{8,15}$/.test(phone) ? `https://wa.me/${phone}` : null
}

export function mailLink(email: string): string {
  return `mailto:${email}`
}

/** Start of a long message for the collapsed view, or null when it is short enough to show whole. */
export function messagePreview(message: string, max = 100): string | null {
  const text = message.replace(/\s+/g, ' ').trim()
  if (text.length <= max && !message.includes('\n')) return null
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`
}

/** "3 contactos", "1 contacto". */
export function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}
