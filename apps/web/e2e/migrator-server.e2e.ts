import type { MigrationResponse, PyLabHealth } from '@aim/contracts/migrator'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { runMigration } from '../src/features/migrator/pipeline'
import { SAMPLE_CSV } from '../src/features/migrator/sample'

// Data migrator with its Python engine simulated (page.route), never the real service on Render. The build
// under test must use PUBLIC_PYLAB_API_URL=https://pylab.test (scripts/ci/build.sh); without it the page has no
// engine choice and these tests are skipped. The fake answers are the browser pipeline's own results, which is
// what the real engine returns (services/py-lab's parity test proves it).

const PATH = '/lab/migrador-de-datos/'
const API = 'https://pylab.test'
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Server-Timing' }

const HEALTH: PyLabHealth = {
  status: 'ok',
  version: '0.1.0',
  limits: {
    maxUploadBytes: 10 * 1024 * 1024,
    maxRows: 50_000,
    maxColumns: 50,
    maxCells: 300_000,
    formats: ['csv', 'xls', 'xlsx'],
  },
}

function migrated(csv: string, delimiter?: ',' | ';') {
  const outcome = runMigration(csv)
  if (!outcome.ok) throw new Error(outcome.error)
  return delimiter ? { ...outcome.result, delimiter } : outcome.result
}

const SUPPLIERS = 'nombre,nit,correo\nAcme,900.123.456,compras@acme.example\nGlobex,800.555.111,sin-correo\n'

function csvAnswer(name: string): MigrationResponse {
  return {
    result: migrated(SAMPLE_CSV),
    meta: {
      source: {
        name,
        bytes: 3115,
        format: 'csv',
        encoding: { name: 'windows-1252', detectedBy: 'charset-normalizer' },
        sheet: null,
        sheets: [],
      },
      timings: { readMs: 31.5, processMs: 12.2, totalMs: 43.7 },
      engine: { name: 'py-lab', version: '0.1.0', python: '3.12.15' },
    },
  }
}

function workbookAnswer(sheet: 'Clientes' | 'Proveedores'): MigrationResponse {
  return {
    result: sheet === 'Clientes' ? migrated(SAMPLE_CSV, ',') : migrated(SUPPLIERS),
    meta: {
      source: {
        name: 'clientes.xlsx',
        bytes: 18_204,
        format: 'xlsx',
        encoding: null,
        sheet,
        sheets: ['Clientes', 'Proveedores'],
      },
      timings: { readMs: 420.3, processMs: 15.8, totalMs: 436.1 },
      engine: { name: 'py-lab', version: '0.1.0', python: '3.12.15' },
    },
  }
}

interface Upload {
  fileName: string | null
  sheet: string | null
}

interface Reply {
  status: number
  json: unknown
}

interface FakeOptions {
  /** /health waits for it, like a server that is still waking up. */
  healthGate?: Promise<unknown>
  migrate?: (upload: Upload, n: number) => Reply
}

/** Reads the parts the client sends; the body is multipart/form-data built by the browser. */
function readUpload(body: Buffer | null): Upload {
  const text = body?.toString('latin1') ?? ''
  const fileName = /name="file"; filename="([^"]*)"/.exec(text)?.[1] ?? null
  const sheet = /name="sheet"\r\n\r\n([^\r]*)\r\n/.exec(text)?.[1] ?? null
  return { fileName, sheet }
}

async function fakePylab(page: Page, options: FakeOptions = {}) {
  const uploads: Upload[] = []
  let healthCalls = 0
  await page.route(`${API}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    let reply: Reply
    if (request.method() === 'GET' && url.pathname === '/health') {
      healthCalls += 1
      if (options.healthGate) await options.healthGate
      reply = { status: 200, json: HEALTH }
    } else if (request.method() === 'POST' && url.pathname === '/v1/migrations') {
      const upload = readUpload(request.postDataBuffer())
      uploads.push(upload)
      reply = options.migrate?.(upload, uploads.length) ?? {
        status: 200,
        json: csvAnswer(upload.fileName ?? ''),
      }
    } else {
      reply = { status: 404, json: { error: 'not_found', message: 'Esta ruta no existe.' } }
    }
    await route
      .fulfill({
        status: reply.status,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify(reply.json),
      })
      .catch(() => {})
  })
  return { uploads, healthCalls: () => healthCalls }
}

/** Opens the page and waits until the island is hydrated (it loads when visible). */
async function open(page: Page) {
  await page.goto(PATH)
  const island = page.locator('astro-island').filter({ has: page.getByText('Sube tu archivo') })
  await island.scrollIntoViewIfNeeded()
  await expect(page.locator('astro-island[ssr]')).toHaveCount(0)
  test.skip(
    (await page.getByRole('radio', { name: /En el servidor/ }).count()) === 0,
    'built without PUBLIC_PYLAB_API_URL',
  )
}

const serverRadio = (page: Page) => page.getByRole('radio', { name: /En el servidor \(Python \+ FastAPI\)/ })
const browserRadio = (page: Page) => page.getByRole('radio', { name: /En tu navegador \(TypeScript\)/ })
const statusLine = (page: Page) =>
  page.getByRole('status').filter({ hasText: /Listo\.|Enviando|Procesando|Cancelaste/ })
const fileInput = (page: Page) => page.locator('input[type="file"]')

/** CSP violations (connect-src must allow the engine's origin; nothing inline may run). */
function watchCsp(page: Page): string[] {
  const violations: string[] = []
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text())
  })
  return violations
}

async function expectToFitTheScreen(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0)
}

async function expectNoSeriousA11yIssues(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

test.describe('Data migrator, Python engine', () => {
  test('the browser stays the default and sends nothing', async ({ page }) => {
    const fake = await fakePylab(page)
    await open(page)
    await expect(browserRadio(page)).toBeChecked()
    await expect(page.getByText('Tu archivo nunca sale de tu navegador.')).toBeVisible()
    await expect(fileInput(page)).toHaveAttribute('accept', '.csv,.txt,text/csv,text/plain')
    await page.getByRole('button', { name: 'Probar con un archivo de ejemplo' }).click()
    await expect(statusLine(page)).toContainText('Listo. 37 filas leídas')
    await expect(page.getByTestId('server-details')).toHaveCount(0)
    expect(fake.uploads).toHaveLength(0)
    expect(fake.healthCalls()).toBe(0)
  })

  test('switching to the server wakes it, says so and processes the sample in Python', async ({ page }) => {
    const violations = watchCsp(page)
    const fake = await fakePylab(page)
    await open(page)
    await serverRadio(page).check()
    await expect(page.getByTestId('server-state')).toContainText('Servidor listo.')
    expect(fake.healthCalls()).toBe(1)
    await expect(page.getByText('Tu archivo viaja al servidor y no se guarda.')).toBeVisible()
    await expect(page.getByText(/de hasta 10 MB, 50\.000 filas y 300\.000 celdas/)).toBeVisible()
    await expect(fileInput(page)).toHaveAttribute('accept', /\.xlsx/)

    await page.getByRole('button', { name: 'Probar con un archivo de ejemplo' }).click()
    await expect(statusLine(page)).toContainText('Listo. 37 filas leídas: 20 válidas')
    expect(fake.uploads).toEqual([{ fileName: 'clientes-ejemplo.csv', sheet: null }])

    const details = page.getByTestId('server-details')
    await expect(details.getByRole('heading', { name: 'Cómo lo leyó el servidor' })).toBeVisible()
    await expect(details).toContainText('Windows-1252 (Excel en español), detectada con charset-normalizer')
    await expect(details).toContainText('44 ms (lectura 32 ms, proceso 12 ms)')
    await expect(details).toContainText('Python 3.12.15 y FastAPI')
    await expect(page.getByText(/Python leyó «clientes-ejemplo\.csv»/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Descargar datos limpios (CSV)' })).toBeEnabled()
    await expectToFitTheScreen(page)
    await expectNoSeriousA11yIssues(page)
    expect(violations).toEqual([])
  })

  test('an Excel workbook with several sheets can be processed sheet by sheet', async ({ page }) => {
    const fake = await fakePylab(page, {
      migrate: (upload) => ({
        status: 200,
        json: workbookAnswer(upload.sheet === 'Proveedores' ? 'Proveedores' : 'Clientes'),
      }),
    })
    await open(page)
    await serverRadio(page).check()
    await expect(page.getByTestId('server-state')).toContainText('Servidor listo.')
    await fileInput(page).setInputFiles({
      name: 'clientes.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('PK\u0003\u0004 libro de prueba'),
    })
    await expect(statusLine(page)).toContainText('Listo. 37 filas leídas')
    const details = page.getByTestId('server-details')
    await expect(details).toContainText('Excel (.xlsx)')
    await expect(page.getByText(/la hoja «Clientes» del libro de Excel/)).toBeVisible()
    await expect(page.getByText(/separadas por comas\. Los montos/)).toBeVisible()

    const sheet = page.getByLabel('Hoja del libro')
    await expect(sheet).toHaveValue('Clientes')
    await sheet.selectOption('Proveedores')
    await expect(statusLine(page)).toContainText('Listo. 2 filas leídas: 1 válida, 1 con errores')
    await expect(sheet).toHaveValue('Proveedores')
    await expect(page.getByText(/la hoja «Proveedores» del libro de Excel/)).toBeVisible()
    expect(fake.uploads).toEqual([
      { fileName: 'clientes.xlsx', sheet: null },
      { fileName: 'clientes.xlsx', sheet: 'Proveedores' },
    ])
    await expectToFitTheScreen(page)
    await expectNoSeriousA11yIssues(page)
  })

  test('says the server is waking up, with the time it has been waiting', async ({ page }) => {
    await page.clock.install()
    let release = () => {}
    const healthGate = new Promise<void>((resolve) => {
      release = resolve
    })
    await fakePylab(page, { healthGate })
    await open(page)
    await serverRadio(page).check()
    const state = page.getByTestId('server-state')
    await expect(state).toContainText('Conectando con el servidor…')

    await page.clock.fastForward(5000)
    await expect(state).toContainText('El servidor de Python está despertando (plan gratuito de Render)')
    await expect(state).toContainText(/Llevas [\d,]+ s esperando\./)

    release()
    await expect(state).toContainText(/Servidor listo: estaba dormido y tardó [\d,]+ s en despertar\./)
  })

  test('shows what the server says when it refuses a file', async ({ page }) => {
    const message =
      'La hoja «Clientes» tiene 80.000 filas y el límite de esta demo es 50.000. Divídela en partes y súbelas por separado.'
    await fakePylab(page, { migrate: () => ({ status: 422, json: { error: 'too_many_rows', message } }) })
    await open(page)
    await serverRadio(page).check()
    await expect(page.getByTestId('server-state')).toContainText('Servidor listo.')
    await fileInput(page).setInputFiles({
      name: 'grande.xlsx',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('PK'),
    })
    await expect(page.getByRole('alert')).toHaveText(message)

    // Checked in the browser before sending: unknown formats never reach the server.
    await fileInput(page).setInputFiles({
      name: 'hoja.ods',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('x'),
    })
    await expect(page.getByRole('alert')).toContainText('guárdalo como .xlsx o como CSV')
    await expectNoSeriousA11yIssues(page)
  })
})
