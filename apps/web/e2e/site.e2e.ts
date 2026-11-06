import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { fakeTurnstile, mockApi, unauthorized } from './fakes'

const pages = [
  '/',
  '/servicios/',
  '/servicios/paginas-web/',
  '/proyectos/',
  '/proyectos/marea/',
  '/proyectos/plataforma-agencia-de-viajes/',
  '/lab/',
  '/lab/asistente-ia/',
  '/cotizar/',
  '/lab/migrador-de-datos/',
  '/lab/auth-lab/',
  '/sobre-mi/',
  '/privacidad/',
  '/contacto/',
  '/admin/',
]

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('aim-theme', t), theme)
      // No third parties and no API in these checks: Turnstile is faked and /admin/ finds no session.
      await fakeTurnstile(page)
      await mockApi(page, () => unauthorized)
    })

    for (const path of pages) {
      test(`${path} renders, fits the screen and has no serious accessibility issues`, async ({ page }) => {
        const response = await page.goto(path)
        expect(response?.ok()).toBe(true)
        await expect(page.locator('h1')).toHaveCount(1)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0)

        const { violations } = await new AxeBuilder({ page }).analyze()
        const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
        expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual(
          [],
        )
      })
    }
  })
}

test('the currency switch changes every visible price', async ({ page, isMobile }) => {
  // Seed COP only on the first load, so the reload below shows what the visitor chose.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('aim-currency', 'COP')
      sessionStorage.setItem('seeded', '1')
    }
  })
  await page.goto('/servicios/')
  const firstPrice = page.locator('[data-price]:visible').first()
  await expect(firstPrice).toContainText('$')
  await expect(firstPrice).not.toContainText('US$')

  await page.getByRole('button', { name: 'USD', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-currency', 'USD')
  await expect(page.locator('[data-price]:visible').first()).toContainText('US$')
  test.skip(isMobile, 'persistence is the same on every device')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-currency', 'USD')
})

test('the theme toggle switches and remembers the theme', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('aim-theme', 'light')
      sessionStorage.setItem('seeded', '1')
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Cambiar entre tema claro y oscuro' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('the hero tabs work with the keyboard', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const idea = page.getByRole('tab', { name: 'Idea' })
  await idea.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Código' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toContainText('parseOrder')
})

test('service rows link to the cotizador with the service preselected', async ({ page }) => {
  await page.goto('/servicios/paginas-web/')
  await expect(page.getByRole('link', { name: 'Cotizar páginas web' })).toHaveAttribute(
    'href',
    '/cotizar/?servicio=web',
  )
})
