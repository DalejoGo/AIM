import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { type ApiCall, fakeTurnstile, invalidGrant, mockApi, TOKEN_PREFIX, unauthorized } from './fakes'

// Forms against a simulated API (page.route) and a fake Turnstile: the static build has no /api.

const EMAIL_OTP_GRANT = 'urn:aim:grant-type:email-otp'
const CREATED = { status: 201, json: { id: '0b6f8c52-7d1e-4a3b-9f2c-5e4d3c2b1a09' } }
const tokenPattern = new RegExp(`^${TOKEN_PREFIX}-\\d+$`)
const token = expect.stringMatching(tokenPattern)

async function expectNoSeriousA11yIssues(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

const leadCalls = (calls: ApiCall[]) => calls.filter((c) => c.method === 'POST' && c.path === '/api/leads')

test.describe('contact form', () => {
  test.beforeEach(async ({ page }) => {
    await fakeTurnstile(page)
  })

  async function open(page: Page) {
    await page.goto('/contacto/')
    // The fake widget only renders once the island is hydrated.
    await expect(page.getByText('Verificación simulada')).toBeVisible()
  }

  async function fillValid(page: Page) {
    await page.getByLabel('Tu nombre').fill('Ana Pérez')
    await page.getByLabel('Correo', { exact: true }).fill('ana@example.com')
    await page.getByLabel('Teléfono o WhatsApp').fill('(300) 123-4567')
    await page.getByLabel('¿Qué necesitas?').selectOption({ label: 'Páginas web' })
    await page.getByLabel('Cuéntame tu proyecto').fill('Quiero una página para mi panadería, con pedidos.')
    await page.getByRole('checkbox', { name: /Acepto que se usen estos datos/ }).check()
  }

  test('sends the message and confirms it', async ({ page }) => {
    const calls = await mockApi(page, (call) => (call.path === '/api/leads' ? CREATED : undefined))
    await open(page)
    await fillValid(page)
    await page.getByRole('button', { name: 'Enviar mensaje' }).click()

    const done = page.getByRole('heading', { name: 'Recibí tu mensaje' })
    await expect(done).toBeVisible()
    await expect(done).toBeFocused()
    await expect(page.getByRole('link', { name: /Escribir por WhatsApp/ }).first()).toBeVisible()
    expect(leadCalls(calls).map((c) => c.body)).toEqual([
      {
        name: 'Ana Pérez',
        email: 'ana@example.com',
        phone: '573001234567',
        service: 'web',
        message: 'Quiero una página para mi panadería, con pedidos.',
        consent: true,
        turnstileToken: token,
      },
    ])
  })

  test('marks every problem before sending and focuses the first one', async ({ page }) => {
    const calls = await mockApi(page, () => undefined)
    await open(page)
    await page.getByRole('button', { name: 'Enviar mensaje' }).click()

    const name = page.getByLabel('Tu nombre')
    await expect(name).toBeFocused()
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText('Escribe tu nombre, entre 2 y 80 caracteres.')).toBeVisible()
    await expect(page.getByLabel('Correo', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText('Déjame un correo o un teléfono para poder responderte.')).toBeVisible()
    await expect(page.getByText('Para enviarlo, acepta la política de privacidad.')).toBeVisible()
    expect(calls).toHaveLength(0)
    await expectNoSeriousA11yIssues(page)
  })

  test('shows the field errors the API returns and retries with a new verification', async ({ page }) => {
    const calls = await mockApi(page, (call, all) => {
      if (call.path !== '/api/leads') return undefined
      return leadCalls(all).length === 1
        ? {
            status: 400,
            json: {
              error: 'invalid_request',
              message: 'Revisa los datos marcados e inténtalo de nuevo.',
              fields: { email: ['Invalid email address'] },
            },
          }
        : CREATED
    })
    await open(page)
    await fillValid(page)
    await page.getByRole('button', { name: 'Enviar mensaje' }).click()

    const email = page.getByLabel('Correo', { exact: true })
    await expect(email).toBeFocused()
    await expect(email).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText('Revisa el correo: debe verse como nombre@dominio.com.')).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'Revisa los datos marcados' })).toBeVisible()

    await email.fill('ana.perez@example.com')
    await expect(email).not.toHaveAttribute('aria-invalid', 'true')
    // The spent token is replaced: wait for the widget to hand out the next one.
    const spent = (leadCalls(calls)[0]?.body as { turnstileToken: string } | undefined)?.turnstileToken ?? ''
    const widget = page.locator('[data-token]')
    await expect(widget).toHaveAttribute('data-token', tokenPattern)
    await expect(widget).not.toHaveAttribute('data-token', spent)
    await page.getByRole('button', { name: 'Enviar mensaje' }).click()
    await expect(page.getByRole('heading', { name: 'Recibí tu mensaje' })).toBeVisible()

    const [first, second] = leadCalls(calls).map((c) => (c.body as { turnstileToken: string }).turnstileToken)
    expect(first).toEqual(token)
    expect(second).toEqual(token)
    // Each token is single use: the widget was reset after the failed request.
    expect(second).not.toBe(first)
  })
})

test.describe('cotizador', () => {
  test('sends the request with the range on screen', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('aim-currency', 'COP'))
    await fakeTurnstile(page)
    const calls = await mockApi(page, (call) => (call.path === '/api/leads' ? CREATED : undefined))
    await page.goto('/cotizar/?servicio=web')
    await expect(page.getByRole('radio', { name: /Páginas web/ })).toBeChecked()
    await page.getByRole('checkbox', { name: /Blog/ }).check()

    const toggle = page.getByRole('button', { name: 'Enviar mi solicitud' })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const form = page.getByRole('form', { name: 'Enviar mi solicitud' })
    await expect(form.getByText('Verificación simulada')).toBeVisible()
    await form.getByLabel('Correo', { exact: true }).fill('ana@example.com')
    await form.getByRole('checkbox', { name: /Acepto que se usen estos datos/ }).check()

    // The name is optional for WhatsApp but the request needs it.
    await form.getByRole('button', { name: 'Enviar solicitud' }).click()
    const name = page.getByLabel('Tu nombre')
    await expect(name).toBeFocused()
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(leadCalls(calls)).toHaveLength(0)

    await name.fill('Ana')
    await form.getByRole('button', { name: 'Enviar solicitud' }).click()
    await expect(page.getByText('Recibí tu solicitud')).toBeFocused()

    const range = await page
      .getByText('Rango estimado', { exact: true })
      .locator('xpath=following-sibling::p[1]')
      .innerText()
    const [min, max] = (range.match(/\d[\d.]*\d/g) ?? []).map((n) => Number(n.replaceAll('.', '')))
    const sent = leadCalls(calls)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.body).toMatchObject({
      name: 'Ana',
      email: 'ana@example.com',
      service: 'web',
      consent: true,
      turnstileToken: token,
      quote: { service: 'web', options: ['blog'], timeline: 'normal', currency: 'COP', min, max },
    })
    expect((sent[0]?.body as { message?: string } | undefined)?.message).toContain('Servicio: Páginas web')
  })
})

// --- Admin -----------------------------------------------------------------------------------------

const principal = {
  sub: 'david@example.com',
  scope: ['leads:read', 'leads:write', 'audit:read'],
  exp: 2_000_000_000,
}
const tokenResponse = { token_type: 'Bearer', expires_in: 900, scope: 'leads:read leads:write audit:read' }

const ana = {
  id: '6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f',
  createdAt: '2026-11-05T15:04:05.000Z',
  status: 'new',
  name: 'Ana Pérez',
  email: 'ana@example.com',
  phone: '573001234567',
  service: 'web',
  message: `Hola. ${'Necesito una página para mi panadería con catálogo y pedidos por WhatsApp. '.repeat(3)}`,
  quote: {
    service: 'web',
    options: ['blog'],
    timeline: 'normal',
    currency: 'COP',
    min: 1_400_000,
    max: 1_890_000,
  },
}
const luis = {
  id: 'b2d4f6a8-1c3e-4a5b-8d7f-0e1f2a3b4c5d',
  createdAt: '2026-11-04T10:00:00.000Z',
  status: 'contacted',
  name: 'Luis Gómez',
  email: null,
  phone: '13055551234',
  service: 'other',
  message: 'Quiero automatizar mis reportes.',
  quote: null,
}
const marta = {
  id: 'c3e5a7b9-2d4f-4b6c-9e8a-1f2a3b4c5d6e',
  createdAt: '2026-11-01T09:30:00.000Z',
  status: 'won',
  name: 'Marta Ruiz',
  email: 'marta@example.com',
  phone: null,
  service: 'chatbot',
  message: 'Un chatbot para mi tienda.',
  quote: null,
}
const audit = [
  {
    id: 'd4f6b8c0-3e5a-4c7d-a9b1-2a3b4c5d6e7f',
    at: '2026-11-06T12:00:00.000Z',
    actor: 'david@example.com',
    action: 'auth.login',
    outcome: 'ok',
  },
  {
    id: 'e5a7c9d1-4f6b-4d8e-b0c2-3b4c5d6e7f80',
    at: '2026-11-06T11:58:00.000Z',
    actor: null,
    action: 'auth.code_requested',
    outcome: 'denied',
  },
]

test.describe('admin panel', () => {
  test.beforeEach(async ({ page }) => {
    await fakeTurnstile(page)
  })

  test('signs in with a code, changes a status, filters, pages and signs out', async ({ page }) => {
    let signedIn = false
    let leads = [ana, luis]
    const calls = await mockApi(page, (call) => {
      const { method, path, query, body } = call
      if (path === '/api/auth/me') return signedIn ? { status: 200, json: principal } : unauthorized
      if (path === '/api/auth/code') {
        return { status: 202, json: { message: 'Si el correo tiene acceso, te enviamos un código.' } }
      }
      if (path === '/api/auth/token') {
        if ((body as { grant_type: string }).grant_type === 'refresh_token') return invalidGrant
        signedIn = true
        return { status: 200, json: tokenResponse }
      }
      if (path === '/api/auth/revoke') {
        signedIn = false
        return { status: 204 }
      }
      if (!signedIn) return unauthorized
      if (path === '/api/admin/leads' && method === 'GET') {
        if (query.get('status') === 'won') return { status: 200, json: { items: [marta], nextCursor: null } }
        if (query.get('cursor') === 'page-2')
          return { status: 200, json: { items: [marta], nextCursor: null } }
        return { status: 200, json: { items: leads, nextCursor: 'page-2' } }
      }
      if (path === `/api/admin/leads/${ana.id}` && method === 'PATCH') {
        const updated = { ...ana, status: (body as { status: string }).status }
        leads = [updated, luis]
        return { status: 200, json: updated }
      }
      if (path === '/api/admin/audit') return { status: 200, json: { items: audit, nextCursor: null } }
      return undefined
    })

    await page.goto('/admin/')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
    await expect(page.getByRole('heading', { name: 'Entrar al panel' })).toBeVisible()
    await expect(page.getByText('Verificación simulada')).toBeVisible()

    await page.getByLabel('Correo', { exact: true }).fill('david@example.com')
    await page.getByRole('button', { name: 'Enviarme un código' }).click()
    await expect(page.getByRole('heading', { name: 'Te enviamos un código' })).toBeFocused()
    const code = page.getByLabel('Código de 6 dígitos')
    await expect(code).toHaveAttribute('inputmode', 'numeric')
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code')
    await code.fill('123 456')
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(page.getByRole('tab', { name: 'Contactos' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator(`#lead-${ana.id}`)).toHaveText('Ana Pérez')
    await expect(page.getByRole('link', { name: 'ana@example.com' })).toHaveAttribute(
      'href',
      'mailto:ana@example.com',
    )
    await expect(page.getByRole('link', { name: /\+13055551234/ })).toHaveAttribute(
      'href',
      'https://wa.me/13055551234',
    )
    await expect(page.getByText('Ver mensaje completo').first()).toBeVisible()
    await expectNoSeriousA11yIssues(page)

    expect(calls.find((c) => c.path === '/api/auth/code')?.body).toEqual({
      email: 'david@example.com',
      turnstileToken: token,
    })
    const grant = (c: ApiCall) => (c.body as { grant_type?: string } | undefined)?.grant_type
    expect(calls.find((c) => c.path === '/api/auth/token' && grant(c) === EMAIL_OTP_GRANT)?.body).toEqual({
      grant_type: EMAIL_OTP_GRANT,
      email: 'david@example.com',
      code: '123456',
    })

    // Status change
    const status = page.getByRole('combobox', { name: 'Estado de Ana Pérez' })
    await status.selectOption({ label: 'Contactado' })
    await expect(page.getByText('Guardé el estado de Ana Pérez: Contactado.')).toBeVisible()
    await expect(status).toHaveValue('contacted')
    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ status: 'contacted' }])

    // Load more by cursor
    await page.getByRole('button', { name: 'Cargar más' }).click()
    await expect(page.locator(`#lead-${marta.id}`)).toBeFocused()
    await expect(page.getByRole('button', { name: 'Cargar más' })).toHaveCount(0)
    expect(calls.some((c) => c.query.get('cursor') === 'page-2')).toBe(true)

    // Filter by status
    await page.getByLabel('Mostrar').selectOption({ label: 'Ganado' })
    await expect(page.getByText('1 contacto con estado ganado.')).toBeVisible()
    await expect(page.locator(`#lead-${ana.id}`)).toHaveCount(0)

    // Access log
    await page.getByRole('tab', { name: 'Accesos' }).click()
    const log = page.getByRole('tabpanel', { name: 'Accesos' })
    await expect(log.getByText('Entró con un código')).toBeVisible()
    await expect(log.getByText('Denegado')).toBeVisible()
    await expect(log.getByText('Sin identificar')).toBeVisible()

    // Sign out
    await page.getByRole('button', { name: 'Cerrar sesión' }).click()
    await expect(page.getByText('Cerraste la sesión.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Entrar al panel' })).toBeVisible()
  })

  test('shows the API message for a wrong code', async ({ page }) => {
    await mockApi(page, ({ path, body }) => {
      if (path === '/api/auth/me') return unauthorized
      if (path === '/api/auth/code') return { status: 202, json: { message: 'Revisa tu correo.' } }
      if (path === '/api/auth/token') {
        return (body as { grant_type: string }).grant_type === 'refresh_token'
          ? invalidGrant
          : {
              status: 400,
              json: { error: 'invalid_grant', message: 'El código no es válido o ya venció.' },
            }
      }
      return undefined
    })
    await page.goto('/admin/')
    await expect(page.getByText('Verificación simulada')).toBeVisible()
    await page.getByLabel('Correo', { exact: true }).fill('david@example.com')
    await page.getByRole('button', { name: 'Enviarme un código' }).click()
    const code = page.getByLabel('Código de 6 dígitos')
    await code.fill('000000')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(code).toBeFocused()
    await expect(code).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText('El código no es válido o ya venció.')).toBeVisible()
  })

  test('renews an expired session once and keeps working', async ({ page }) => {
    let renewed = false
    const calls = await mockApi(page, ({ path }) => {
      if (path === '/api/auth/me') return { status: 200, json: principal }
      if (path === '/api/auth/token') {
        renewed = true
        return { status: 200, json: tokenResponse }
      }
      if (path === '/api/admin/leads') {
        return renewed ? { status: 200, json: { items: [luis], nextCursor: null } } : unauthorized
      }
      return undefined
    })
    await page.goto('/admin/')
    await expect(page.locator(`#lead-${luis.id}`)).toHaveText('Luis Gómez')
    expect(calls.filter((c) => c.path === '/api/auth/token')).toHaveLength(1)
  })

  test('goes back to the login when the session cannot be renewed', async ({ page }) => {
    await mockApi(page, ({ path }) => {
      if (path === '/api/auth/me') return { status: 200, json: principal }
      if (path === '/api/auth/token') return invalidGrant
      if (path === '/api/admin/leads') return unauthorized
      return undefined
    })
    await page.goto('/admin/')
    await expect(page.getByText('Tu sesión terminó. Vuelve a entrar con tu correo.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Entrar al panel' })).toBeVisible()
  })
})
