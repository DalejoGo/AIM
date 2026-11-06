import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

// "Seguridad en acción" against a simulated /api/lab/burst (page.route): 10 accepted, then 429 with
// Retry-After, like apps/edge/src/routes/lab.ts. The static E2E server sends no security headers, so the tests
// that need them answer the HEAD to / with the ones Cloudflare adds in production (public/_headers).

const PATH = '/lab/seguridad-en-accion/'
const LIMIT = 10

const SITE_HEADERS: Record<string, string> = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
}

async function siteHeaders(page: Page, headers: Record<string, string>) {
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      if (route.request().method() !== 'HEAD') return route.fallback()
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
      })
    },
  )
}

interface BurstOptions {
  retryAfter?: number
  /** Answers wait for it, so a test can look at the page while the burst runs. */
  gate?: Promise<unknown>
  /** Overrides the n-th answer (from 1). */
  reply?: (n: number) => { status: number; json: unknown } | undefined
}

async function mockBurst(page: Page, { retryAfter = 30, gate, reply }: BurstOptions = {}) {
  const calls = { count: 0 }
  await page.route('**/api/lab/burst', async (route) => {
    const n = ++calls.count
    if (gate) await gate
    const custom = reply?.(n)
    if (custom) {
      await route.fulfill({ status: custom.status, json: custom.json })
      return
    }
    const remaining = Math.max(0, LIMIT - n)
    const rateLimit = {
      'RateLimit-Policy': `${LIMIT};w=10`,
      'RateLimit-Limit': String(LIMIT),
      'RateLimit-Remaining': String(remaining),
    }
    if (n <= LIMIT) {
      await route.fulfill({
        status: 200,
        headers: { ...rateLimit, 'RateLimit-Reset': '10' },
        json: { ok: true, remaining, resetInSeconds: 10 },
      })
      return
    }
    await route.fulfill({
      status: 429,
      headers: { ...rateLimit, 'RateLimit-Reset': String(retryAfter), 'Retry-After': String(retryAfter) },
      json: {
        error: 'rate_limited',
        message: `Llegaste al límite de 10 peticiones cada 10 segundos. Vuelve a intentarlo en ${retryAfter} segundos.`,
      },
    })
  })
  return calls
}

/** Opens the demo and waits until the island is hydrated (its header check has finished). */
async function open(page: Page) {
  await page.goto(PATH)
  await page.getByRole('heading', { name: 'Límite de tasa en vivo' }).scrollIntoViewIfNeeded()
  await expect(page.getByText(/^(Llegaron|No llegó ninguna)/)).toBeVisible()
}

async function expectNoSeriousA11yIssues(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

const sendButton = (page: Page) => page.getByRole('button', { name: 'Enviar 15 peticiones' })
const timelineRows = (page: Page) =>
  page.getByRole('table', { name: /Respuesta de la API a cada petición/ }).locator('tbody tr')

test.describe('rate limit in action', () => {
  test('sends 15 requests one by one, draws the timeline and counts down the Retry-After', async ({
    page,
  }) => {
    await page.clock.install()
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const calls = await mockBurst(page, { gate })
    await open(page)

    const button = sendButton(page)
    await button.click()
    await expect(button).toBeDisabled()
    await expect(page.getByText('Enviando la petición 1 de 15…')).toBeVisible()
    // A second click while it runs starts nothing.
    await button.click({ force: true })
    release()

    await expect(timelineRows(page)).toHaveCount(15)
    await expect(button).toBeEnabled()
    expect(calls.count).toBe(15)

    const rows = timelineRows(page)
    await expect(rows.nth(0)).toContainText('200')
    await expect(rows.nth(0).locator('td').last()).toHaveText('9')
    await expect(rows.nth(9)).toContainText('200')
    await expect(rows.nth(9).locator('td').last()).toHaveText('0')
    for (const i of [10, 14]) {
      await expect(rows.nth(i)).toContainText('429')
      await expect(rows.nth(i)).toContainText('frenada')
    }
    await expect(rows.nth(0).getByRole('rowheader')).toHaveText('1')
    await expect(rows.nth(0).locator('td').nth(1)).toHaveText(/^\d+ ms$/)

    await expect(page.getByText('10 pasaron y 5 fueron frenadas.', { exact: true })).toBeVisible()
    await expect(page.getByText(/^Vuelve a intentarlo en (30|29) segundos\.$/)).toBeVisible()
    const announcement = page.getByRole('status').filter({ hasText: '10 pasaron y 5 fueron frenadas.' })
    await expect(announcement).toContainText(/Vuelve a intentarlo en (30|29) segundos\./)

    const lastAnswer = page.locator('pre').filter({ hasText: 'HTTP 429' })
    await expect(lastAnswer).toContainText('RateLimit-Remaining: 0')
    await expect(lastAnswer).toContainText('Retry-After: 30')

    await page.clock.fastForward(10_000)
    await expect(page.getByText(/^Vuelve a intentarlo en (20|19) segundos\.$/)).toBeVisible()
    await page.clock.fastForward(21_000)
    await expect(page.getByText('Ya puedes volver a intentarlo.').first()).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Ya puedes volver a intentarlo.' })).toHaveCount(
      1,
    )
  })

  test('runs again from an empty timeline', async ({ page }) => {
    const calls = await mockBurst(page)
    await open(page)
    await sendButton(page).click()
    await expect(timelineRows(page)).toHaveCount(15)
    await sendButton(page).click()
    await expect(page.getByText('Ninguna pasó: las 15 fueron frenadas.', { exact: true })).toBeVisible()
    await expect(timelineRows(page)).toHaveCount(15)
    expect(calls.count).toBe(30)
  })

  test('stops and says what happened when the API fails', async ({ page }) => {
    await mockBurst(page, {
      reply: (n) =>
        n === 3
          ? {
              status: 500,
              json: {
                error: 'internal',
                message: 'Algo falló de nuestro lado. Inténtalo de nuevo en unos minutos.',
              },
            }
          : undefined,
    })
    await open(page)
    await sendButton(page).click()

    await expect(page.getByRole('alert')).toHaveText(
      'Algo falló de nuestro lado. Inténtalo de nuevo en unos minutos.',
    )
    await expect(timelineRows(page)).toHaveCount(3)
    await expect(timelineRows(page).nth(2)).toContainText('500')
    await expect(page.getByRole('paragraph').filter({ hasText: /^2 pasaron y 1 falló\.$/ })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '2 pasaron y 1 falló.' })).toHaveCount(1)
    await expect(sendButton(page)).toBeEnabled()
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`the finished burst fits the screen and is accessible in the ${theme} theme`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('aim-theme', t), theme)
      await siteHeaders(page, SITE_HEADERS)
      await mockBurst(page)
      await open(page)
      await sendButton(page).click()
      await expect(page.getByText('10 pasaron y 5 fueron frenadas.', { exact: true })).toBeVisible()

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0)
      await expectNoSeriousA11yIssues(page)
    })
  }
})

test.describe('security headers of the site', () => {
  test('shows each header with its real value, what it stops and its OWASP category', async ({ page }) => {
    const { 'x-frame-options': _missing, ...headers } = SITE_HEADERS
    const csp = "default-src 'self'; frame-ancestors 'none'"
    await siteHeaders(page, { ...headers, 'content-security-policy': csp })
    await open(page)

    await expect(page.getByText('Llegaron 5 de 6 cabeceras. Falta una.')).toBeVisible()
    const list = page.getByRole('list', { name: 'Cabeceras de seguridad' })
    await expect(list.getByRole('listitem')).toHaveCount(7)

    const hsts = list.getByRole('listitem').filter({ hasText: 'Strict-Transport-Security' })
    await expect(hsts.locator('code')).toHaveText('max-age=31536000; includeSubDomains')
    await expect(hsts).toContainText('Presente')
    await expect(hsts).toContainText('HTTPS')
    await expect(hsts).toContainText('OWASP A02:2021')

    const frame = list.getByRole('listitem').filter({ hasText: 'X-Frame-Options' })
    await expect(frame).toContainText('No llegó')
    await expect(frame.locator('code')).toHaveCount(0)
    await expect(frame).toContainText('clickjacking')

    const policy = list.getByRole('listitem').filter({ hasText: 'Content-Security-Policy' })
    await expect(policy.locator('code')).toHaveText(csp)
    await expect(policy).toContainText('OWASP A03:2021')
    await expect(page.getByText(/las agrega Cloudflare cuando el sitio está publicado/)).toBeVisible()
  })

  test('says plainly that no header arrived instead of making them up', async ({ page }) => {
    // The static E2E server, like a local copy of the site, sends none of them.
    await open(page)

    await expect(page.getByText('No llegó ninguna de las 6 cabeceras en esta respuesta.')).toBeVisible()
    await expect(page.getByText(/es normal que no lleguen/)).toBeVisible()
    const items = page.getByRole('list', { name: 'Cabeceras de seguridad' }).getByRole('listitem')
    const withoutCsp = items.filter({ hasNotText: 'Content-Security-Policy' })
    await expect(withoutCsp).toHaveCount(6)
    for (const item of await withoutCsp.all()) await expect(item).toContainText('No llegó')
  })
})
