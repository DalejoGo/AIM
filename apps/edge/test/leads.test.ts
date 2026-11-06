import type { QuoteSnapshot } from '@aim/contracts'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fixedCaptcha } from '../src/adapters/captcha'
import { leads } from '../src/db/schema'
import { createTestContext, type TestContext } from './helpers'

const TOKEN = 'turnstile-token-that-must-not-be-stored'

const validLead = {
  name: 'Ana Pérez',
  email: 'ana@example.com',
  service: 'web',
  message: 'Necesito una página para mi panadería.',
  consent: true,
  turnstileToken: TOKEN,
}

const quote: QuoteSnapshot = {
  service: 'app',
  options: ['Usuarios y roles', 'Pagos en línea'],
  timeline: 'Sin afán',
  currency: 'COP',
  min: 4_500_000,
  max: 5_400_000,
}

function postLead(t: TestContext, body: unknown, ip?: string) {
  return t.request('/api/leads', {
    method: 'POST',
    body: JSON.stringify(body),
    ...(ip ? { ip } : {}),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/leads', () => {
  it('stores a lead with e-mail and no quote, normalized and without the IP or the token', async () => {
    const t = await createTestContext()
    const res = await postLead(t, {
      ...validLead,
      name: '  Ana \n  Pérez ',
      email: ' Ana@Example.COM ',
      message: '  Necesito una página\r\npara mi panadería.  ',
    })

    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    expect(id).toMatch(/^[0-9a-f-]{36}$/)

    const [row] = await t.db.select().from(leads)
    expect(row).toMatchObject({
      id,
      status: 'new',
      name: 'Ana Pérez',
      email: 'ana@example.com',
      phone: null,
      service: 'web',
      message: 'Necesito una página\npara mi panadería.',
      quote: null,
    })
    expect(row?.consentAt).toEqual(t.clock.now)
    expect(row?.createdAt).toEqual(t.clock.now)
    expect(row?.ipHash).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const stored = JSON.stringify(row)
    expect(stored).not.toContain('203.0.113.7')
    expect(stored).not.toContain(TOKEN)
  })

  it('stores a lead with phone and the quote the visitor saw', async () => {
    const t = await createTestContext()
    const { email: _email, ...withoutEmail } = validLead
    const res = await postLead(t, { ...withoutEmail, phone: '573001234567', service: 'app', quote })

    expect(res.status).toBe(201)
    const [row] = await t.db.select().from(leads)
    expect(row).toMatchObject({ email: null, phone: '573001234567', service: 'app', quote })
  })

  describe('with invalid fields', () => {
    // Nothing is stored on a 400, so these cases share one database.
    let t: TestContext
    beforeAll(async () => {
      t = await createTestContext()
    })

    it.each([
      ['without consent', { consent: false }, 'consent', 'política de privacidad'],
      ['without e-mail nor phone', { email: undefined }, 'email', 'correo o un teléfono'],
      ['with an unknown service', { service: 'hosting' }, 'service', 'servicios de la lista'],
      ['with a short message', { message: 'Hola' }, 'message', '10 a 2000 caracteres'],
      ['with a malformed phone', { phone: '+57 300' }, 'phone', 'solo con números'],
      ['without the Turnstile token', { turnstileToken: '' }, 'turnstileToken', 'verificación de seguridad'],
    ])('answers 400 %s, with a Spanish message on the field', async (_case, change, field, hint) => {
      const res = await postLead(t, { ...validLead, ...change })

      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string; message: string; fields: Record<string, string[]> }
      expect(body.error).toBe('invalid_request')
      expect(body.message).toMatch(/Revisa los datos/)
      expect(body.fields[field]?.join(' ')).toContain(hint)
      expect(await t.db.select().from(leads)).toEqual([])
    })
  })

  it('reports an invalid quote under the quote field', async () => {
    const t = await createTestContext()
    const res = await postLead(t, { ...validLead, quote: { ...quote, currency: 'EUR' } })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { fields: Record<string, string[]> }
    expect(body.fields['quote.currency']?.[0]).toContain('cotizador')
  })

  it('answers 422 when Turnstile rejects the token, and stores nothing', async () => {
    const t = await createTestContext({ captcha: fixedCaptcha(false) })
    const res = await postLead(t, validLead)

    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({
      error: 'captcha_failed',
      message: expect.stringContaining('completa la verificación'),
    })
    await t.settle()
    expect(await t.db.select().from(leads)).toEqual([])
    expect(t.mailer.sent).toEqual([])
  })

  it('answers 503 when Turnstile cannot be reached', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const t = await createTestContext({
      captcha: {
        verify: async () => {
          throw new Error('network down')
        },
      },
    })
    const res = await postLead(t, validLead)

    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: 'captcha_unavailable' })
    expect(await t.db.select().from(leads)).toEqual([])
  })

  it('accepts 5 leads per IP per hour, then answers 429 with Retry-After until the hour passes', async () => {
    const t = await createTestContext()
    const start = t.clock.now
    for (let i = 0; i < 5; i++) expect((await postLead(t, validLead)).status).toBe(201)

    t.clock.now = new Date(start.getTime() + 30 * 60 * 1000)
    const limited = await postLead(t, validLead)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('1800')
    expect(await limited.json()).toMatchObject({
      error: 'rate_limited',
      message: expect.stringContaining('30 minutos'),
    })

    // Another IP is not affected.
    expect((await postLead(t, validLead, '198.51.100.20')).status).toBe(201)

    t.clock.now = new Date(start.getTime() + 60 * 60 * 1000)
    expect((await postLead(t, validLead)).status).toBe(201)
    expect(await t.db.select().from(leads)).toHaveLength(7)
  })

  it('e-mails David with the contact, the quote and a link to the panel', async () => {
    const t = await createTestContext()
    const res = await postLead(t, { ...validLead, phone: '573001234567', service: 'app', quote })
    expect(res.status).toBe(201)
    await t.settle()

    expect(t.mailer.sent).toHaveLength(1)
    const [mail] = t.mailer.sent
    expect(mail?.to).toBe('david@aim.test')
    expect(mail?.subject).toBe('Nuevo contacto: Ana Pérez (Aplicativos web)')
    for (const part of [mail?.text, mail?.html]) {
      expect(part).toContain('ana@example.com')
      expect(part).toContain('573001234567')
      expect(part).toContain('Necesito una página para mi panadería.')
      expect(part).toContain('COP')
      expect(part).toMatch(/4\.500\.000.*5\.400\.000/)
      expect(part).toContain('Usuarios y roles, Pagos en línea')
      expect(part).toContain('https://aim.test/admin/')
    }
  })

  it('says when there is no quote nor phone', async () => {
    const t = await createTestContext()
    await postLead(t, validLead)
    await t.settle()

    const text = t.mailer.sent[0]?.text ?? ''
    expect(text).toContain('Teléfono: No lo dejó')
    expect(text).toContain('No adjuntó cotización.')
  })

  it('escapes everything the visitor wrote in the HTML of the notice', async () => {
    const t = await createTestContext()
    await postLead(t, {
      ...validLead,
      name: '<script>alert(1)</script>',
      message: 'Hola <img src=x onerror="alert(2)"> & "adiós" \'ya\'',
    })
    await t.settle()

    const html = t.mailer.sent[0]?.html ?? ''
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain(
      '&lt;img src=x onerror=&quot;alert(2)&quot;&gt; &amp; &quot;adiós&quot; &#39;ya&#39;',
    )
    expect(t.mailer.sent[0]?.subject).toBe('Nuevo contacto: <script>alert(1)</script> (Páginas web)')
  })

  it('keeps the lead and the 201 when the notice cannot be sent', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const t = await createTestContext()
    t.mailer.send = async () => {
      throw new Error('Resend answered 500')
    }

    const res = await postLead(t, validLead)
    expect(res.status).toBe(201)
    await expect(t.settle()).resolves.toBeUndefined()
    expect(await t.db.select().from(leads)).toHaveLength(1)
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('lead notification failed'))
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('Resend answered 500'))
  })
})
