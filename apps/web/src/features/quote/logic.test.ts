import { QuoteConfig, type ServiceId } from '@aim/contracts'
import { describe, expect, it } from 'vitest'
import { quote } from '../../lib/site'
import {
  availableServices,
  buildMessage,
  CURRENCY_LIST,
  currencyName,
  defaultTimelineId,
  estimate,
  findTimeline,
  formatRange,
  keepOwnOptions,
  parseServiceParam,
  type QuoteSummary,
  roundFor,
  type ServiceSummary,
  summarize,
  surchargeLabel,
} from './logic'

// Intl uses non-breaking spaces; normalise them (and only them: messages keep their line breaks).
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ')

// A fixture instead of src/content/quote.json, so price edits in content never break these tests.
const config = QuoteConfig.parse({
  spread: 0.35,
  timelines: [
    { id: 'normal', label: 'Sin afán', multiplier: 1 },
    { id: 'prioritario', label: 'Lo necesito pronto', multiplier: 1.2 },
    { id: 'urgente', label: 'Es urgente', multiplier: 1.45 },
  ],
  services: [
    {
      service: 'web',
      base: { COP: 900000, USD: 250 },
      options: [
        { id: 'blog', label: 'Blog', description: 'Publica artículos.', price: { COP: 500000, USD: 140 } },
        {
          id: 'catalogo',
          label: 'Catálogo con pedido por WhatsApp',
          description: 'Productos con fotos y precios.',
          price: { COP: 900000, USD: 250 },
        },
      ],
    },
    {
      service: 'automation',
      base: { COP: 600000, USD: 170 },
      options: [
        {
          id: 'reportes',
          label: 'Reportes automáticos',
          description: 'Un resumen cada semana.',
          price: { COP: 400000, USD: 110 },
        },
      ],
    },
  ],
})

const services: ServiceSummary[] = [
  { id: 'web', title: 'Páginas web', tagline: 'Tu negocio, encontrado y contactado.' },
  { id: 'app', title: 'Aplicativos web', tagline: 'El sistema que tu operación necesita.' },
  { id: 'automation', title: 'Automatizaciones', tagline: 'Que las tareas repetitivas se hagan solas.' },
]

const ids: ServiceId[] = ['web', 'automation']

const pick = (service: ServiceId | null, options: string[] = [], timeline = 'normal') => ({
  service,
  options,
  timeline,
})

function summaryOf(selection: ReturnType<typeof pick>, currency: 'COP' | 'USD' = 'COP'): QuoteSummary {
  const summary = summarize(config, services, selection, currency)
  if (!summary) throw new Error('Expected a complete selection')
  return summary
}

describe('roundFor', () => {
  it('rounds pesos to the nearest 10.000', () => {
    expect(roundFor(1_234_999, 'COP')).toBe(1_230_000)
    expect(roundFor(1_235_000, 'COP')).toBe(1_240_000)
    expect(roundFor(1_244_999, 'COP')).toBe(1_240_000)
  })

  it('rounds dollars to the nearest 10', () => {
    expect(roundFor(344, 'USD')).toBe(340)
    expect(roundFor(345, 'USD')).toBe(350)
    expect(roundFor(631.8, 'USD')).toBe(630)
  })

  it('keeps exact multiples and zero', () => {
    expect(roundFor(900_000, 'COP')).toBe(900_000)
    expect(roundFor(250, 'USD')).toBe(250)
    expect(roundFor(0, 'COP')).toBe(0)
  })

  it('rounds half steps up despite floating point noise', () => {
    // 2_300_000 * 1.45 is 3_334_999.9999999995 in floating point.
    expect(roundFor(2_300_000 * 1.45, 'COP')).toBe(3_340_000)
    expect(roundFor(250 * 1.35, 'USD')).toBe(340)
  })
})

describe('estimate', () => {
  it('needs a service', () => {
    expect(estimate(config, pick(null), 'COP')).toBeNull()
  })

  it('returns null for a service without pricing', () => {
    expect(estimate(config, pick('app'), 'COP')).toBeNull()
  })

  it('prices the base service at the normal pace in pesos', () => {
    expect(estimate(config, pick('web'), 'COP')).toEqual({
      currency: 'COP',
      subtotal: 900_000,
      low: 900_000,
      high: 1_220_000, // 1_215_000 rounded
    })
  })

  it('prices the base service at the normal pace in dollars', () => {
    expect(estimate(config, pick('web'), 'USD')).toEqual({
      currency: 'USD',
      subtotal: 250,
      low: 250,
      high: 340,
    })
  })

  it('adds the options and applies the timeline multiplier', () => {
    // (900_000 + 500_000) * 1.2 = 1_680_000; * 1.35 = 2_268_000
    expect(estimate(config, pick('web', ['blog'], 'prioritario'), 'COP')).toEqual({
      currency: 'COP',
      subtotal: 1_400_000,
      low: 1_680_000,
      high: 2_270_000,
    })
    // (250 + 140) * 1.2 = 468; * 1.35 = 631.8
    expect(estimate(config, pick('web', ['blog'], 'prioritario'), 'USD')).toEqual({
      currency: 'USD',
      subtotal: 390,
      low: 470,
      high: 630,
    })
  })

  it('applies the rush multiplier to every option', () => {
    // 2_300_000 * 1.45 = 3_335_000; * 1.35 = 4_502_250
    expect(estimate(config, pick('web', ['blog', 'catalogo'], 'urgente'), 'COP')).toMatchObject({
      subtotal: 2_300_000,
      low: 3_340_000,
      high: 4_500_000,
    })
  })

  it('computes the upper end from the unrounded lower end', () => {
    // 640 * 1.45 = 928 (shown as 930); 928 * 1.35 = 1252.8 (1250), while 930 * 1.35 would give 1255.5 (1260).
    expect(estimate(config, pick('web', ['blog', 'catalogo'], 'urgente'), 'USD')).toMatchObject({
      low: 930,
      high: 1250,
    })
  })

  it('ignores options that belong to another service', () => {
    const own = estimate(config, pick('web', ['blog']), 'COP')
    expect(estimate(config, pick('web', ['blog', 'reportes']), 'COP')).toEqual(own)
    expect(estimate(config, pick('automation', ['blog']), 'COP')).toMatchObject({ subtotal: 600_000 })
  })

  it('counts a repeated option once', () => {
    expect(estimate(config, pick('web', ['blog', 'blog']), 'COP')).toMatchObject({ subtotal: 1_400_000 })
  })

  it('uses the normal pace for an unknown timeline', () => {
    expect(estimate(config, pick('web', [], 'ayer'), 'COP')).toEqual(estimate(config, pick('web'), 'COP'))
  })

  it('collapses the range when there is no spread', () => {
    const exact = { ...config, spread: 0 }
    expect(estimate(exact, pick('web', [], 'prioritario'), 'COP')).toMatchObject({
      low: 1_080_000,
      high: 1_080_000,
    })
  })
})

describe('options and timelines', () => {
  it('keeps only the options of the service, once, in the configured order', () => {
    expect(keepOwnOptions(config, 'web', ['catalogo', 'reportes', 'blog', 'blog'])).toEqual([
      'blog',
      'catalogo',
    ])
    expect(keepOwnOptions(config, 'automation', ['catalogo', 'reportes'])).toEqual(['reportes'])
  })

  it('keeps no options without a service', () => {
    expect(keepOwnOptions(config, null, ['blog'])).toEqual([])
  })

  it('defaults to the first timeline and falls back to it', () => {
    expect(defaultTimelineId(config)).toBe('normal')
    expect(findTimeline(config, 'urgente')?.multiplier).toBe(1.45)
    expect(findTimeline(config, 'mañana')?.id).toBe('normal')
  })

  it('lists only the services that have pricing, in the given order', () => {
    expect(availableServices(services, config).map((s) => s.id)).toEqual(['web', 'automation'])
  })

  it('describes each multiplier in words', () => {
    expect(surchargeLabel(1)).toBe('Sin recargo')
    expect(surchargeLabel(1.2)).toBe('Recargo del 20 %')
    expect(surchargeLabel(1.45)).toBe('Recargo del 45 %')
    expect(surchargeLabel(0.9)).toBe('Descuento del 10 %')
  })
})

describe('formatting', () => {
  it('formats a range in pesos and in dollars', () => {
    expect(plain(formatRange({ currency: 'COP', subtotal: 0, low: 900_000, high: 1_220_000 }))).toBe(
      '$ 900.000 a $ 1.220.000',
    )
    expect(plain(formatRange({ currency: 'USD', subtotal: 0, low: 250, high: 340 }))).toBe(
      'US$ 250 a US$ 340',
    )
  })

  it('shows a single amount when both ends match', () => {
    expect(plain(formatRange({ currency: 'USD', subtotal: 0, low: 250, high: 250 }))).toBe('US$ 250')
  })

  it('names every currency', () => {
    expect(CURRENCY_LIST).toEqual(['COP', 'USD'])
    expect(currencyName('COP')).toBe('pesos colombianos')
    expect(currencyName('USD')).toBe('dólares estadounidenses')
  })
})

describe('summarize', () => {
  it('waits for a service', () => {
    expect(summarize(config, services, pick(null), 'COP')).toBeNull()
  })

  it('needs the service to be listed on the site', () => {
    expect(summarize(config, [], pick('web'), 'COP')).toBeNull()
  })

  it('collects the chosen service, options and timeline', () => {
    const summary = summaryOf(pick('web', ['catalogo', 'reportes', 'blog'], 'urgente'))
    expect(summary.service.title).toBe('Páginas web')
    expect(summary.options.map((o) => o.id)).toEqual(['blog', 'catalogo'])
    expect(summary.timeline.label).toBe('Es urgente')
    expect(summary.estimate.currency).toBe('COP')
  })
})

describe('buildMessage', () => {
  it('writes the full message with name and idea', () => {
    const message = buildMessage(summaryOf(pick('web', ['blog'], 'prioritario')), {
      name: 'Ana',
      idea: 'Una tienda de ropa para mi barrio.',
    })
    expect(plain(message)).toBe(
      [
        'Hola, soy Ana. Hice este cálculo en el cotizador y me gustaría recibir una propuesta.',
        '',
        'Servicio: Páginas web',
        'Funcionalidades: Blog',
        'Plazo: Lo necesito pronto',
        'Rango estimado: $ 1.680.000 a $ 2.270.000',
        '',
        'Mi idea: Una tienda de ropa para mi barrio.',
      ].join('\n'),
    )
  })

  it('greets without a name and leaves out an empty idea', () => {
    const message = buildMessage(summaryOf(pick('web')), { name: '   ', idea: '  \n ' })
    expect(message.startsWith('Hola. Hice este cálculo')).toBe(true)
    expect(message).not.toContain('soy')
    expect(message).not.toContain('Mi idea')
  })

  it('works without contact details at all', () => {
    expect(buildMessage(summaryOf(pick('web'))).split('\n')[0]).toBe(
      'Hola. Hice este cálculo en el cotizador y me gustaría recibir una propuesta.',
    )
  })

  it('tidies the name and keeps line breaks in the idea', () => {
    const message = buildMessage(summaryOf(pick('web')), {
      name: '  Ana \n  María ',
      idea: ' Primero esto.\nLuego aquello. ',
    })
    expect(message).toContain('Hola, soy Ana María.')
    expect(message.endsWith('Mi idea: Primero esto.\nLuego aquello.')).toBe(true)
  })

  it('says when no options were chosen', () => {
    expect(buildMessage(summaryOf(pick('automation')))).toContain('Funcionalidades: ninguna adicional')
  })

  it('lists several options and uses the chosen currency', () => {
    const message = plain(buildMessage(summaryOf(pick('web', ['catalogo', 'blog'], 'urgente'), 'USD')))
    expect(message).toContain('Funcionalidades: Blog, Catálogo con pedido por WhatsApp')
    expect(message).toContain('Plazo: Es urgente')
    expect(message).toContain('Rango estimado: US$ 930 a US$ 1.250')
  })
})

describe('parseServiceParam', () => {
  it('reads a valid service', () => {
    expect(parseServiceParam('?servicio=web', ids)).toEqual({ kind: 'valid', service: 'web' })
    expect(parseServiceParam(new URLSearchParams('servicio=automation&utm=x'), ids)).toEqual({
      kind: 'valid',
      service: 'automation',
    })
  })

  it('forgives case and spaces', () => {
    expect(parseServiceParam('?servicio=%20WEB%20', ids)).toEqual({ kind: 'valid', service: 'web' })
  })

  it('reports nothing when the parameter is missing or empty', () => {
    expect(parseServiceParam('', ids)).toEqual({ kind: 'none' })
    expect(parseServiceParam('?otro=web', ids)).toEqual({ kind: 'none' })
    expect(parseServiceParam('?servicio=', ids)).toEqual({ kind: 'none' })
  })

  it('reports an unknown or unpriced service', () => {
    expect(parseServiceParam('?servicio=tienda', ids)).toEqual({ kind: 'invalid', value: 'tienda' })
    expect(parseServiceParam('?servicio=app', ids)).toEqual({ kind: 'invalid', value: 'app' })
  })

  it('shortens a long unknown value', () => {
    const result = parseServiceParam(`?servicio=${'x'.repeat(200)}`, ids)
    expect(result).toEqual({ kind: 'invalid', value: 'x'.repeat(40) })
  })
})

describe('with the real quote.json', () => {
  it('gives an ordered, rounded range for every service, timeline and currency', () => {
    for (const service of quote.services) {
      const options = service.options.map((o) => o.id)
      for (const timeline of quote.timelines) {
        for (const currency of CURRENCY_LIST) {
          const range = estimate(
            quote,
            { service: service.service, options, timeline: timeline.id },
            currency,
          )
          expect(range).not.toBeNull()
          if (!range) continue
          const step = currency === 'COP' ? 10_000 : 10
          expect(range.low % step).toBe(0)
          expect(range.high % step).toBe(0)
          expect(range.high).toBeGreaterThanOrEqual(range.low)
        }
      }
    }
  })
})
