import type { Currency, Lead, QuoteSnapshot } from '@aim/contracts'
import type { Mail, Mailer } from '../deps'
import type { EdgeEnv } from '../env'
import { log } from '../lib/log'

// New-lead notice for David (DEC-016). Everything that comes from the visitor is escaped in the HTML.

export type LeadNotice = Pick<Lead, 'id' | 'name' | 'email' | 'phone' | 'service' | 'message' | 'quote'>

/** Same names as the service pages (apps/web/src/content/services). */
const SERVICE_LABELS: Record<Lead['service'], string> = {
  web: 'Páginas web',
  app: 'Aplicativos web',
  automation: 'Automatizaciones',
  content: 'Blogs y contenido web',
  chatbot: 'Chatbots',
  other: 'Otro',
}

const NOT_GIVEN = 'No lo dejó'

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch)
}

const money = new Map<Currency, Intl.NumberFormat>()

function formatMoney(amount: number, currency: Currency): string {
  let formatter = money.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 })
    money.set(currency, formatter)
  }
  return formatter.format(amount)
}

function quoteLines(quote: QuoteSnapshot): [string, string][] {
  return [
    [
      'Rango',
      `${formatMoney(quote.min, quote.currency)} – ${formatMoney(quote.max, quote.currency)} ${quote.currency}`,
    ],
    ['Servicio cotizado', SERVICE_LABELS[quote.service]],
    ['Plazo', quote.timeline],
    ['Opciones', quote.options.length > 0 ? quote.options.join(', ') : 'Ninguna adicional'],
  ]
}

export function buildLeadNotice(lead: LeadNotice, env: Pick<EdgeEnv, 'NOTIFY_TO' | 'SITE_ORIGIN'>): Mail {
  const service = SERVICE_LABELS[lead.service]
  const adminUrl = new URL('/admin/', env.SITE_ORIGIN).href
  const contact: [string, string][] = [
    ['Nombre', lead.name],
    ['Correo', lead.email ?? NOT_GIVEN],
    ['Teléfono', lead.phone ?? NOT_GIVEN],
    ['Servicio', service],
  ]
  const quote = lead.quote ? quoteLines(lead.quote) : null

  const text = [
    'Llegó un contacto nuevo desde el sitio.',
    '',
    ...contact.map(([label, value]) => `${label}: ${value}`),
    '',
    'Mensaje:',
    lead.message,
    '',
    ...(quote
      ? ['Cotización que vio:', ...quote.map(([label, value]) => `- ${label}: ${value}`)]
      : ['No adjuntó cotización.']),
    '',
    `Revísalo y cambia su estado en el panel: ${adminUrl}`,
  ].join('\n')

  const row = ([label, value]: [string, string]) =>
    `<tr><th align="left" style="padding:4px 12px 4px 0">${escapeHtml(label)}</th><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`
  const html = [
    '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">',
    '<p>Llegó un contacto nuevo desde el sitio.</p>',
    `<table style="border-collapse:collapse">${contact.map(row).join('')}</table>`,
    '<p><strong>Mensaje</strong></p>',
    `<p style="white-space:pre-wrap">${escapeHtml(lead.message)}</p>`,
    quote
      ? `<p><strong>Cotización que vio</strong></p><table style="border-collapse:collapse">${quote.map(row).join('')}</table>`
      : '<p>No adjuntó cotización.</p>',
    `<p><a href="${escapeHtml(adminUrl)}">Revísalo y cambia su estado en el panel</a></p>`,
    '</div>',
  ].join('')

  return {
    to: env.NOTIFY_TO,
    // Single line: a header never carries line breaks from the visitor.
    subject: `Nuevo contacto: ${lead.name.replace(/\s+/g, ' ')} (${service})`,
    text,
    html,
  }
}

/** Never rejects: the lead is already stored, so a mail failure is only logged. */
export async function notifyNewLead(
  mailer: Mailer,
  env: Pick<EdgeEnv, 'NOTIFY_TO' | 'SITE_ORIGIN'>,
  lead: LeadNotice,
): Promise<void> {
  try {
    await mailer.send(buildLeadNotice(lead, env))
  } catch (err) {
    log.error('lead notification failed', {
      leadId: lead.id,
      error: err instanceof Error ? err.message : err,
    })
  }
}
