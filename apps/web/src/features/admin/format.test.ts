import { LEAD_STATUSES, QuoteConfig } from '@aim/contracts'
import { describe, expect, it } from 'vitest'
import {
  actionLabel,
  buildCatalog,
  countLabel,
  describeQuote,
  formatDateTime,
  mailLink,
  messagePreview,
  phoneLink,
  STATUS_LABELS,
  STATUS_ORDER,
  serviceLabel,
} from './format'

// Intl uses non-breaking spaces; normalise them.
const plain = (s: string) => s.replace(/[  ]/g, ' ')

const quote = QuoteConfig.parse({
  spread: 0.35,
  timelines: [
    { id: 'normal', label: 'Sin afán', multiplier: 1 },
    { id: 'urgente', label: 'Es urgente', multiplier: 1.45 },
  ],
  services: [
    {
      service: 'web',
      base: { COP: 900000, USD: 250 },
      options: [{ id: 'blog', label: 'Blog', description: 'Artículos.', price: { COP: 500000, USD: 140 } }],
    },
  ],
})

const catalog = buildCatalog(
  [
    { id: 'web', title: 'Páginas web' },
    { id: 'other', title: 'Otro' },
  ],
  quote,
)

describe('labels', () => {
  it('names every lead status in Spanish, in the contract order', () => {
    expect(STATUS_ORDER).toEqual([...LEAD_STATUSES])
    expect(STATUS_ORDER.map((s) => STATUS_LABELS[s])).toEqual([
      'Nuevo',
      'Contactado',
      'Ganado',
      'Perdido',
      'Spam',
    ])
  })

  it('translates known audit actions and keeps unknown ones', () => {
    expect(actionLabel('auth.login')).toBe('Entró con un código')
    expect(actionLabel('lead.deleted')).toBe('lead.deleted')
  })

  it('names services, with the id as fallback', () => {
    expect(serviceLabel(catalog, 'web')).toBe('Páginas web')
    expect(serviceLabel(catalog, 'other')).toBe('Otro')
    expect(serviceLabel(catalog, 'chatbot')).toBe('chatbot')
  })
})

describe('describeQuote', () => {
  it('reads the snapshot with the names from content', () => {
    const description = describeQuote(
      {
        service: 'web',
        options: ['blog', 'retirada'],
        timeline: 'urgente',
        currency: 'COP',
        min: 1_300_000,
        max: 1_760_000,
      },
      catalog,
    )
    expect({ ...description, range: plain(description.range) }).toEqual({
      range: '$ 1.300.000 a $ 1.760.000 COP',
      timeline: 'Es urgente',
      options: ['Blog', 'retirada'],
    })
  })

  it('shows a single amount when the range is closed', () => {
    const description = describeQuote(
      { service: 'app', options: [], timeline: 'otro', currency: 'USD', min: 250, max: 250 },
      catalog,
    )
    expect(plain(description.range)).toBe('US$ 250 USD')
    expect(description.timeline).toBe('otro')
  })
})

describe('formatting', () => {
  it('formats dates and keeps invalid ones', () => {
    expect(formatDateTime('2026-11-06T15:04:05.000Z')).toMatch(/2026/)
    expect(formatDateTime('ayer')).toBe('ayer')
  })

  it('links phones to WhatsApp only when they are digits in international format', () => {
    expect(phoneLink('573001234567')).toBe('https://wa.me/573001234567')
    expect(phoneLink('+57 300')).toBeNull()
    expect(mailLink('ana@example.com')).toBe('mailto:ana@example.com')
  })

  it('previews long or multi-line messages only', () => {
    expect(messagePreview('Hola, quiero una página.')).toBeNull()
    expect(messagePreview('Hola.\nQuiero una página.')).toBe('Hola. Quiero una página.')
    const preview = messagePreview('palabra '.repeat(40), 20)
    expect(preview).toBe('palabra palabra pala…')
  })

  it('counts in singular and plural', () => {
    expect(countLabel(1, 'contacto', 'contactos')).toBe('1 contacto')
    expect(countLabel(0, 'contacto', 'contactos')).toBe('0 contactos')
  })
})
