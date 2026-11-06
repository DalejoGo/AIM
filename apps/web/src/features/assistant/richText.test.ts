import { describe, expect, it } from 'vitest'
import { type Inline, parseInline, parseRichText, safeHref } from './richText'

const text = (value: string, strong = false): Inline => ({ type: 'text', text: value, strong })
const link = (value: string, href: string, strong = false): Inline => ({
  type: 'link',
  text: value,
  href,
  strong,
})
const paragraph = (...lines: Inline[][]) => ({ type: 'paragraph' as const, lines })

const WHATSAPP = 'https://wa.me/573027015524'

describe('safeHref', () => {
  it.each([
    '/',
    '/cotizar/',
    '/contacto/',
    '/cotizar/?servicio=web',
    '/servicios/paginas-web/#precios',
    '/media/david-gomez-hoja-de-vida.pdf',
  ])('keeps the site path %s', (href) => {
    expect(safeHref(href)).toBe(href)
  })

  it('keeps WhatsApp links, normalized', () => {
    expect(safeHref(WHATSAPP)).toBe(WHATSAPP)
    expect(safeHref(`${WHATSAPP}?text=Hola%20David`)).toBe(`${WHATSAPP}?text=Hola%20David`)
    expect(safeHref(` ${WHATSAPP} `)).toBe(WHATSAPP)
  })

  it.each([
    ['protocol-relative', '//evil.example/'],
    ['backslash host', '/\\evil.example/'],
    ['tab before a slash', '/\t/evil.example/'],
    ['space', '/cotizar/ x'],
    ['quote', '/a"onclick="x'],
    ['angle bracket', '/a<script>'],
    ['javascript', 'javascript:alert(1)'],
    ['javascript upper case', 'JavaScript:alert(1)'],
    ['data', 'data:text/html,<script>alert(1)</script>'],
    ['mailto', 'mailto:alguien@example.com'],
    ['another site', 'https://example.com/'],
    ['plain http WhatsApp', 'http://wa.me/573027015524'],
    ['look-alike host', 'https://wa.me.evil.example/'],
    ['user info', 'https://wa.me@evil.example/'],
    ['relative', 'cotizar/'],
    ['empty', ''],
  ])('refuses a %s link', (_, href) => {
    expect(safeHref(href)).toBeNull()
  })
})

describe('parseInline', () => {
  it('keeps plain text as one piece', () => {
    expect(parseInline('Hola, ¿en qué te ayudo?')).toEqual([text('Hola, ¿en qué te ayudo?')])
  })

  it('reads **bold** text', () => {
    expect(parseInline('Desde **COP 900.000** o **USD 250**.')).toEqual([
      text('Desde '),
      text('COP 900.000', true),
      text(' o '),
      text('USD 250', true),
      text('.'),
    ])
  })

  it('shows an unpaired ** as typed', () => {
    expect(parseInline('**uno** y ** suelto')).toEqual([text('uno', true), text(' y ** suelto')])
    expect(parseInline('5 ** 2')).toEqual([text('5 ** 2')])
  })

  it('links site paths in Markdown links', () => {
    expect(parseInline('Usa el [cotizador](/cotizar/) para ver un rango.')).toEqual([
      text('Usa el '),
      link('cotizador', '/cotizar/'),
      text(' para ver un rango.'),
    ])
  })

  it('links WhatsApp in Markdown links', () => {
    expect(parseInline(`[Escríbele por WhatsApp](${WHATSAPP})`)).toEqual([
      link('Escríbele por WhatsApp', WHATSAPP),
    ])
  })

  it('shows other Markdown links as text, with the address', () => {
    expect(parseInline('Mira [su LinkedIn](https://www.linkedin.com/in/x).')).toEqual([
      text('Mira su LinkedIn (https://www.linkedin.com/in/x).'),
    ])
    expect(parseInline('[clic](javascript:alert(1))')).toEqual([text('[clic](javascript:alert(1))')])
    expect(parseInline('[clic](javascript:alert)')).toEqual([text('clic (javascript:alert)')])
    expect(parseInline('[/cotizar/](//evil.example/)')).toEqual([text('/cotizar/ (//evil.example/)')])
  })

  it('links bare site paths, leaving the punctuation of the sentence out', () => {
    expect(parseInline('Escribe desde /contacto/. O usa /cotizar/?servicio=web, es rápido.')).toEqual([
      text('Escribe desde '),
      link('/contacto/', '/contacto/'),
      text('. O usa '),
      link('/cotizar/?servicio=web', '/cotizar/?servicio=web'),
      text(', es rápido.'),
    ])
    expect(parseInline('(/cotizar/)')).toEqual([text('('), link('/cotizar/', '/cotizar/'), text(')')])
  })

  it('links bare WhatsApp addresses', () => {
    expect(parseInline(`Escríbele a ${WHATSAPP}.`)).toEqual([
      text('Escríbele a '),
      link(WHATSAPP, WHATSAPP),
      text('.'),
    ])
  })

  it('keeps other bare addresses as text, without linking the paths inside them', () => {
    expect(parseInline('Su perfil: https://github.com/DalejoGo/ y https://evil.example/cotizar/')).toEqual([
      text('Su perfil: https://github.com/DalejoGo/ y https://evil.example/cotizar/'),
    ])
  })

  it('does not take slashes inside words or numbers for pages', () => {
    expect(parseInline('Soporte 24/7, y/o USD 250 /mes, a/b/c.')).toEqual([
      text('Soporte 24/7, y/o USD 250 /mes, a/b/c.'),
    ])
  })

  it('keeps bold around links', () => {
    expect(parseInline('**Cotiza en /cotizar/**')).toEqual([
      text('Cotiza en ', true),
      link('/cotizar/', '/cotizar/', true),
    ])
    expect(parseInline(`**${WHATSAPP}**`)).toEqual([link(WHATSAPP, WHATSAPP, true)])
  })

  it('drops bold marks inside a link label', () => {
    expect(parseInline('[**Cotizar**](/cotizar/)')).toEqual([link('Cotizar', '/cotizar/')])
  })

  it('drops inline code marks', () => {
    expect(parseInline('Entra a `/cotizar/`.')).toEqual([
      text('Entra a '),
      link('/cotizar/', '/cotizar/'),
      text('.'),
    ])
  })

  it('keeps markup as text: the component never parses HTML', () => {
    const markup = '<img src=x onerror="alert(1)"><script>alert(1)</script>'
    expect(parseInline(markup)).toEqual([text(markup)])
  })
})

describe('parseRichText', () => {
  it('gives nothing for an empty answer', () => {
    expect(parseRichText('')).toEqual([])
    expect(parseRichText('\n \n')).toEqual([])
  })

  it('splits paragraphs on blank lines and keeps single line breaks', () => {
    expect(parseRichText('Hola.\nTe cuento.\n\n\nOtra idea.')).toEqual([
      paragraph([text('Hola.')], [text('Te cuento.')]),
      paragraph([text('Otra idea.')]),
    ])
  })

  it('reads bullet lists with -, * or •', () => {
    expect(parseRichText('Incluye:\n- Diseño\n* **SEO** básico\n• Publicación')).toEqual([
      paragraph([text('Incluye:')]),
      {
        type: 'list',
        ordered: false,
        start: 1,
        items: [[text('Diseño')], [text('SEO', true), text(' básico')], [text('Publicación')]],
      },
    ])
  })

  it('reads numbered lists and keeps their first number', () => {
    expect(parseRichText('3. Diseño\n4) Desarrollo')).toEqual([
      { type: 'list', ordered: true, start: 3, items: [[text('Diseño')], [text('Desarrollo')]] },
    ])
  })

  it('keeps a list together across blank lines between items', () => {
    const blocks = parseRichText('- uno\n\n- dos\n\nFin.')
    expect(blocks).toEqual([
      { type: 'list', ordered: false, start: 1, items: [[text('uno')], [text('dos')]] },
      paragraph([text('Fin.')]),
    ])
  })

  it('joins an indented line to the item above it', () => {
    expect(parseRichText('- Páginas web:\n  desde USD 250\n- Chatbots')).toEqual([
      {
        type: 'list',
        ordered: false,
        start: 1,
        items: [[text('Páginas web: desde USD 250')], [text('Chatbots')]],
      },
    ])
  })

  it('flattens nested items into the same list', () => {
    expect(parseRichText('- uno\n  - uno a\n- dos')).toEqual([
      { type: 'list', ordered: false, start: 1, items: [[text('uno')], [text('uno a')], [text('dos')]] },
    ])
  })

  it('starts a new list when the kind changes, and a paragraph after a list', () => {
    expect(parseRichText('- a\n1. b\nTexto')).toEqual([
      { type: 'list', ordered: false, start: 1, items: [[text('a')]] },
      { type: 'list', ordered: true, start: 1, items: [[text('b')]] },
      paragraph([text('Texto')]),
    ])
  })

  it('does not take bold at the start of a line for a list item', () => {
    expect(parseRichText('**Nota:** depende del alcance.')).toEqual([
      paragraph([text('Nota:', true), text(' depende del alcance.')]),
    ])
  })

  it('turns headings into bold lines and skips rules and code fences', () => {
    expect(parseRichText('## Precios ##\nDesde USD 250.\n\n---\n```\nTexto\n```')).toEqual([
      paragraph([text('Precios', true)]),
      paragraph([text('Desde USD 250.')]),
      paragraph([text('Texto')]),
    ])
  })

  it('accepts CRLF line endings', () => {
    expect(parseRichText('a\r\nb\r\n\r\n- c')).toEqual([
      paragraph([text('a')], [text('b')]),
      { type: 'list', ordered: false, start: 1, items: [[text('c')]] },
    ])
  })

  it('drops empty list items', () => {
    expect(parseRichText('- \n- uno')).toEqual([
      { type: 'list', ordered: false, start: 1, items: [[text('uno')]] },
    ])
  })

  it('parses a typical answer', () => {
    const answer = [
      'Una **página web** arranca desde **COP 900.000** (USD 250). Incluye:',
      '',
      '- Diseño pensado para celular',
      '- Botón de WhatsApp',
      '',
      `Calcula tu rango en /cotizar/?servicio=web o escríbele a David: ${WHATSAPP}`,
    ].join('\n')
    const blocks = parseRichText(answer)
    expect(blocks).toHaveLength(3)
    expect(blocks[2]).toEqual(
      paragraph([
        text('Calcula tu rango en '),
        link('/cotizar/?servicio=web', '/cotizar/?servicio=web'),
        text(' o escríbele a David: '),
        link(WHATSAPP, WHATSAPP),
      ]),
    )
  })
})
