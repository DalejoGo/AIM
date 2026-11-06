import type {
  Currency,
  QuoteConfig,
  QuoteOption,
  QuoteService,
  QuoteSnapshot,
  QuoteTimeline,
  ServiceId,
} from '@aim/contracts'
import { formatMoney } from '../../lib/money'

// Pure cotizador rules: no DOM, no signals. Type-only contract imports keep zod out of the island bundle.

/** Query parameter other pages use to open the cotizador with a service chosen: /cotizar/?servicio=web */
export const SERVICE_PARAM = 'servicio'

/** Estimates are rounded so they read as a reference range, not as an invoice. */
export const ROUNDING_STEP: Record<Currency, number> = { COP: 10_000, USD: 10 }

/** Every supported currency, derived from an exhaustive record so a new currency fails the type check here. */
export const CURRENCY_LIST = Object.keys(ROUNDING_STEP) as Currency[]

const CURRENCY_NAMES: Record<Currency, string> = { COP: 'pesos colombianos', USD: 'dólares estadounidenses' }

/** What the island needs from each service entry in src/content/services. */
export interface ServiceSummary {
  id: ServiceId
  title: string
  tagline: string
}

export interface Selection {
  service: ServiceId | null
  options: readonly string[]
  timeline: string
}

export interface Estimate {
  currency: Currency
  /** Base plus options, before the timeline multiplier and without rounding. */
  subtotal: number
  low: number
  high: number
}

export interface QuoteSummary {
  service: ServiceSummary
  options: readonly QuoteOption[]
  timeline: QuoteTimeline
  estimate: Estimate
}

export interface Contact {
  name?: string
  idea?: string
}

export type ServiceParam =
  | { kind: 'none' }
  | { kind: 'valid'; service: ServiceId }
  | { kind: 'invalid'; value: string }

/** Rounds to the nearest step of the currency (COP: 10.000, USD: 10); halves round up. */
export function roundFor(amount: number, currency: Currency): number {
  const step = ROUNDING_STEP[currency]
  // toPrecision drops float noise first: 2_300_000 × 1.45 is 3_334_999.9999…, which must still round to a half step.
  return Math.round(Number((amount / step).toPrecision(12))) * step
}

export function findService(config: QuoteConfig, id: ServiceId | null): QuoteService | undefined {
  return id === null ? undefined : config.services.find((s) => s.service === id)
}

export function optionsFor(config: QuoteConfig, id: ServiceId | null): readonly QuoteOption[] {
  return findService(config, id)?.options ?? []
}

/** Keeps only the options that belong to the service, without duplicates and in the configured order. */
export function keepOwnOptions(
  config: QuoteConfig,
  id: ServiceId | null,
  optionIds: readonly string[],
): string[] {
  const chosen = new Set(optionIds)
  return optionsFor(config, id)
    .filter((o) => chosen.has(o.id))
    .map((o) => o.id)
}

/** The first configured timeline is the normal pace and the default choice. */
export function defaultTimelineId(config: QuoteConfig): string {
  return config.timelines[0]?.id ?? ''
}

/** Finds a timeline by id; an unknown id falls back to the default one. */
export function findTimeline(config: QuoteConfig, id: string): QuoteTimeline | undefined {
  return config.timelines.find((t) => t.id === id) ?? config.timelines[0]
}

/** Services that the site lists and the cotizador prices, in the order received. */
export function availableServices(
  services: readonly ServiceSummary[],
  config: QuoteConfig,
): ServiceSummary[] {
  return services.filter((s) => findService(config, s.id) !== undefined)
}

/**
 * The estimated range: [subtotal × timeline multiplier, that value × (1 + spread)], each end rounded.
 * Options from other services are ignored. Returns null until a priced service is chosen.
 */
export function estimate(config: QuoteConfig, selection: Selection, currency: Currency): Estimate | null {
  const service = findService(config, selection.service)
  if (!service) return null
  const chosen = new Set(selection.options)
  const subtotal = service.options
    .filter((o) => chosen.has(o.id))
    .reduce((sum, o) => sum + o.price[currency], service.base[currency])
  const low = subtotal * (findTimeline(config, selection.timeline)?.multiplier ?? 1)
  const high = low * (1 + config.spread)
  return { currency, subtotal, low: roundFor(low, currency), high: roundFor(high, currency) }
}

/** Everything the summary step and the message need, or null while the selection is incomplete. */
export function summarize(
  config: QuoteConfig,
  services: readonly ServiceSummary[],
  selection: Selection,
  currency: Currency,
): QuoteSummary | null {
  const service = services.find((s) => s.id === selection.service)
  const timeline = findTimeline(config, selection.timeline)
  const range = estimate(config, selection, currency)
  if (!service || !timeline || !range) return null
  const chosen = new Set(selection.options)
  const options = optionsFor(config, service.id).filter((o) => chosen.has(o.id))
  return { service, options, timeline, estimate: range }
}

export function formatRange({ low, high, currency }: Estimate): string {
  return low === high
    ? formatMoney(low, currency)
    : `${formatMoney(low, currency)} a ${formatMoney(high, currency)}`
}

export function currencyName(currency: Currency): string {
  return CURRENCY_NAMES[currency]
}

/** How a timeline changes the price, in words: "Sin recargo", "Recargo del 20 %", "Descuento del 10 %". */
export function surchargeLabel(multiplier: number): string {
  const percent = Math.round((multiplier - 1) * 100)
  if (percent === 0) return 'Sin recargo'
  return percent > 0 ? `Recargo del ${percent} %` : `Descuento del ${-percent} %`
}

const singleLine = (text = '') => text.replace(/\s+/g, ' ').trim()

/** The text sent by WhatsApp and copied to the clipboard. Empty name or idea are left out. */
export function buildMessage(summary: QuoteSummary, contact: Contact = {}): string {
  const name = singleLine(contact.name)
  const idea = contact.idea?.trim() ?? ''
  const options = summary.options.map((o) => o.label).join(', ') || 'ninguna adicional'
  const lines = [
    `${name ? `Hola, soy ${name}.` : 'Hola.'} Hice este cálculo en el cotizador y me gustaría recibir una propuesta.`,
    '',
    `Servicio: ${summary.service.title}`,
    `Funcionalidades: ${options}`,
    `Plazo: ${summary.timeline.label}`,
    `Rango estimado: ${formatRange(summary.estimate)}`,
  ]
  if (idea) lines.push('', `Mi idea: ${idea}`)
  return lines.join('\n')
}

/** Longest message a lead accepts (CreateLead). */
export const LEAD_MESSAGE_MAX = 2000

/** What the API stores with a lead sent from the cotizador: ids and the range the visitor saw. */
export function buildQuoteSnapshot(summary: QuoteSummary): QuoteSnapshot {
  return {
    service: summary.service.id,
    options: summary.options.map((o) => o.id),
    timeline: summary.timeline.id,
    currency: summary.estimate.currency,
    min: summary.estimate.low,
    max: summary.estimate.high,
  }
}

/** The lead message is the same text WhatsApp would carry, cut to the length the API accepts. */
export function leadMessage(summary: QuoteSummary, contact: Contact = {}): string {
  return buildMessage(summary, contact).slice(0, LEAD_MESSAGE_MAX)
}

/** Reads ?servicio= from a query string. Case and surrounding spaces are forgiven; unknown ids are reported. */
export function parseServiceParam(search: string | URLSearchParams, ids: readonly ServiceId[]): ServiceParam {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const raw = params.get(SERVICE_PARAM)?.trim() ?? ''
  if (!raw) return { kind: 'none' }
  const service = ids.find((id) => id === raw.toLowerCase())
  return service ? { kind: 'valid', service } : { kind: 'invalid', value: raw.slice(0, 40) }
}
