import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { fakeTurnstile, mockApi, unauthorized } from './fakes'

// Every page runs under the Content Security Policy that Astro writes as a <meta> (astro.config.ts,
// src/lib/csp.ts). A violation fires `securitypolicyviolation` and logs a console error: either one fails.
// Turnstile is the fake from fakes.ts, served at Cloudflare's real address, so the CSP judges the same URL
// as in production; E2E_REAL_TURNSTILE=1 also loads the real widget (needs internet).

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

/** Lab demos: the live ones at their own address, the rest at /lab/<slug>/ (from src/content/lab/). */
function labPages(): string[] {
  const dir = join(import.meta.dirname, '../src/content/lab')
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => {
      const text = readFileSync(join(dir, file), 'utf8')
      const field = (name: string) => text.match(new RegExp(`^${name}:\\s*(\\S+)\\s*$`, 'm'))?.[1]
      const href = field('href')
      return field('status') === 'live' && href ? href : `/lab/${field('slug')}/`
    })
}

const pages = [
  ...new Set([
    '/',
    '/servicios/',
    '/servicios/paginas-web/',
    '/proyectos/',
    '/proyectos/marea/',
    '/proyectos/plataforma-agencia-de-viajes/',
    '/lab/',
    ...labPages(),
    '/cotizar/',
    '/sobre-mi/',
    '/privacidad/',
    '/contacto/',
    '/admin/',
  ]),
]

/** Pages whose form shows the Turnstile widget as soon as the island hydrates (the reviewer: without a session). */
const TURNSTILE_PAGES = new Set(['/contacto/', '/admin/', '/lab/asistente-ia/', '/lab/revisor-de-codigo/'])

/** Collects CSP violations of the page (not of Cloudflare's own iframe, which has its own policy). */
async function watchCsp(page: Page): Promise<string[]> {
  const violations: string[] = []
  await page.exposeFunction('reportCspViolation', (violation: string) => violations.push(violation))
  await page.addInitScript(() => {
    if (window !== window.top) return
    document.addEventListener('securitypolicyviolation', (event) => {
      const report = (window as unknown as { reportCspViolation: (v: string) => void }).reportCspViolation
      const where = event.sourceFile ? ` at ${event.sourceFile}:${event.lineNumber}` : ''
      report(
        `${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}${where} ${event.sample}`.trim(),
      )
    })
  })
  page.on('console', (message) => {
    const fromCloudflare = message.location().url.startsWith(TURNSTILE_ORIGIN)
    if (!fromCloudflare && /Content Security Policy/i.test(message.text())) violations.push(message.text())
  })
  return violations
}

/** Brings every client:visible island into view and waits until all are hydrated (Astro drops `ssr`). */
async function wakeIslands(page: Page) {
  for (const island of await page.locator('astro-island[client="visible"]').all()) {
    await island.scrollIntoViewIfNeeded()
  }
  await expect(page.locator('astro-island[ssr]')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
}

async function policy(page: Page): Promise<string> {
  const meta = page.locator('meta[http-equiv="content-security-policy"]')
  await expect(meta).toHaveCount(1)
  return (await meta.getAttribute('content')) ?? ''
}

test.describe('Content Security Policy', () => {
  test.beforeEach(async ({ page }) => {
    await fakeTurnstile(page)
    await mockApi(page, () => unauthorized)
  })

  test('the policy allows only what the site uses', async ({ page }) => {
    await page.goto('/')
    const content = await policy(page)
    for (const directive of [
      "default-src 'self'",
      "connect-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "media-src 'self'",
      `frame-src ${TURNSTILE_ORIGIN}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      `script-src 'self' ${TURNSTILE_ORIGIN} 'sha256-`,
      "style-src 'self' 'sha256-",
    ]) {
      expect(content).toContain(directive)
    }
    expect(content).not.toContain('unsafe-inline')
    expect(content).not.toContain('unsafe-eval')
  })

  for (const path of pages) {
    test(`${path} has no CSP violations`, async ({ page }) => {
      const violations = await watchCsp(page)
      const response = await page.goto(path)
      expect(response?.ok()).toBe(true)
      await policy(page)
      await wakeIslands(page)
      if (TURNSTILE_PAGES.has(path)) await expect(page.getByText('Verificación simulada')).toBeVisible()
      expect(violations).toEqual([])
    })
  }

  test('the 404 page has no CSP violations', async ({ page }) => {
    const violations = await watchCsp(page)
    const response = await page.goto('/no-existe/')
    expect(response?.status()).toBe(404)
    await policy(page)
    await wakeIslands(page)
    expect(violations).toEqual([])
  })

  test('the cotizador request form loads its code and Turnstile without violations', async ({ page }) => {
    const violations = await watchCsp(page)
    await page.goto('/cotizar/?servicio=web')
    await expect(page.getByRole('radio', { name: /Páginas web/ })).toBeChecked()
    await page.getByRole('button', { name: 'Enviar mi solicitud' }).click()
    const form = page.getByRole('form', { name: 'Enviar mi solicitud' })
    await expect(form.getByText('Verificación simulada')).toBeVisible()
    expect(violations).toEqual([])
  })

  test('the data migrator processes the sample file without violations', async ({ page }) => {
    const violations = await watchCsp(page)
    await page.goto('/lab/migrador-de-datos/')
    await wakeIslands(page)
    await page.getByRole('button', { name: 'Probar con un archivo de ejemplo' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Listo.' })).toBeVisible()
    expect(violations).toEqual([])
  })

  test('the Auth Lab draws every step of its diagram without violations', async ({ page }) => {
    const violations = await watchCsp(page)
    await page.goto('/lab/auth-lab/')
    await wakeIslands(page)
    const next = page.getByRole('button', { name: 'Siguiente paso' })
    const diagram = page.getByRole('figure', { name: 'Quién envía qué en este paso' })
    await expect(diagram).toBeVisible()
    // Walks forward until a step asks for an action first (the button turns aria-disabled).
    let steps = 0
    while (steps < 6 && (await next.isVisible()) && (await next.getAttribute('aria-disabled')) !== 'true') {
      const before = await diagram.innerText()
      await next.click()
      await expect(diagram).not.toHaveText(before)
      steps += 1
    }
    expect(steps).toBeGreaterThan(0)
    expect(violations).toEqual([])
  })

  test('switching the theme redraws Turnstile without violations', async ({ page }) => {
    const violations = await watchCsp(page)
    await page.goto('/contacto/')
    await expect(page.getByText('Verificación simulada')).toBeVisible()
    await page.getByRole('button', { name: 'Cambiar entre tema claro y oscuro' }).click()
    await expect(page.getByText('Verificación simulada')).toBeVisible()
    expect(violations).toEqual([])
  })
})

test.describe('Content Security Policy with the real Turnstile', () => {
  test.skip(
    !process.env.E2E_REAL_TURNSTILE,
    'set E2E_REAL_TURNSTILE=1 to load the real widget (needs internet)',
  )

  test('Cloudflare loads its script and its challenge frame on /contacto/', async ({ page }) => {
    const violations = await watchCsp(page)
    await page.goto('/contacto/')
    // Outside production the build uses Cloudflare's always-pass test key (features/turnstile/siteKey.ts).
    // The challenge iframe lives in Cloudflare's shadow root: look for its frame, then for the token it hands out.
    await expect
      .poll(() => page.frames().some((frame) => frame.url().startsWith(`${TURNSTILE_ORIGIN}/`)), {
        timeout: 20_000,
      })
      .toBe(true)
    await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/\S/, { timeout: 20_000 })
    await expect(page.getByText('La verificación no cargó')).toBeHidden()
    expect(violations).toEqual([])
  })
})
