import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

// API Playground against a simulated Tareas API (page.route), never the real one on Render. The build under
// test must use PUBLIC_PLAYGROUND_API_URL=https://playground.test; without it the page only shows the
// "not configured" notice, and these tests are skipped.

const PATH = '/lab/api-playground/'
const API = 'https://playground.test'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** What apps/api/src/app.ts sends to the site's origin. The console runs with credentials omitted. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE',
  'access-control-allow-headers': 'Content-Type,X-Sandbox-Id',
  'access-control-expose-headers':
    'X-Response-Time,Location,Retry-After,X-RateLimit-Limit,X-RateLimit-Remaining,X-RateLimit-Reset',
}

interface Task {
  id: string
  title: string
  description: string | null
  status: 'pending' | 'in_progress' | 'done'
  priority: 'low' | 'medium' | 'high'
  dueDate: string | null
  createdAt: string
  updatedAt: string
}

interface Call {
  method: string
  path: string
  query: URLSearchParams
  sandboxId: string | undefined
  body: unknown
}

interface Reply {
  status: number
  json?: unknown
  headers?: Record<string, string>
}

interface FakeOptions {
  /** Answers wait for it, like an API that is still waking up. */
  gate?: Promise<unknown>
  /** Replaces the fake's own answer for the n-th call (from 1). */
  reply?: (call: Call, n: number) => Reply | undefined
}

const ISO = '2026-11-05T15:00:00.000Z'

function sampleTasks(): Task[] {
  const task = (n: number, title: string, status: Task['status'], priority: Task['priority']): Task => ({
    id: `aaaaaaaa-0000-4000-8000-00000000000${n}`,
    title,
    description: null,
    status,
    priority,
    dueDate: null,
    createdAt: ISO,
    updatedAt: ISO,
  })
  return [
    task(1, 'Configurar alertas de monitoreo', 'pending', 'low'),
    task(2, 'Documentar la API con OpenAPI', 'in_progress', 'medium'),
    task(3, 'Diseñar el modelo de datos', 'done', 'high'),
  ]
}

const invalid = (fields: Record<string, string[]>): Reply => ({
  status: 400,
  json: {
    error: 'invalid_request',
    message: 'Hay datos que no son válidos. Revisa los campos marcados.',
    fields,
  },
})

function validate(body: unknown): Record<string, string[]> | null {
  const input = (body ?? {}) as Record<string, unknown>
  const fields: Record<string, string[]> = {}
  if (typeof input.title !== 'string' || input.title.trim().length < 3) {
    fields.title = ['El título debe tener al menos 3 caracteres.']
  }
  if (input.priority !== undefined && !['low', 'medium', 'high'].includes(String(input.priority))) {
    fields.priority = ['La prioridad debe ser low, medium o high.']
  }
  if (input.dueDate !== undefined && Number.isNaN(Date.parse(String(input.dueDate)))) {
    fields.dueDate = [
      'La fecha límite debe estar en formato ISO 8601 con hora, por ejemplo 2026-12-01T17:00:00Z.',
    ]
  }
  return Object.keys(fields).length > 0 ? fields : null
}

/** A small in-memory Tareas API with the answers of apps/api (statuses, ApiError, Location, headers). */
function tasksApi() {
  const tasks = sampleTasks()
  let created = 0
  const notFound = (id: string): Reply => ({
    status: 404,
    json: { error: 'not_found', message: `No encontramos la tarea ${id} en tu sandbox.` },
  })

  return (call: Call): Reply => {
    const match = /^\/api\/v1\/tasks(?:\/([^/]+))?\/?$/.exec(call.path)
    if (!match) {
      return {
        status: 404,
        json: { error: 'not_found', message: `No existe la ruta ${call.method} ${call.path}.` },
      }
    }
    const id = match[1]
    if (!id && call.method === 'GET') {
      const status = call.query.get('status')
      const items = tasks.filter((task) => !status || task.status === status)
      return { status: 200, json: { items, nextCursor: null } }
    }
    if (!id && call.method === 'POST') {
      const fields = validate(call.body)
      if (fields) return invalid(fields)
      const input = call.body as Partial<Task>
      const task: Task = {
        id: `bbbbbbbb-0000-4000-8000-${String(++created).padStart(12, '0')}`,
        title: String(input.title).trim(),
        description: input.description ?? null,
        status: input.status ?? 'pending',
        priority: input.priority ?? 'medium',
        dueDate: input.dueDate ?? null,
        createdAt: ISO,
        updatedAt: ISO,
      }
      tasks.unshift(task)
      return { status: 201, json: task, headers: { location: `/api/v1/tasks/${task.id}` } }
    }
    if (id === 'stats' && call.method === 'GET') {
      return { status: 200, json: { total: tasks.length, overdue: 0 } }
    }
    const index = tasks.findIndex((task) => task.id === id)
    const task = tasks[index]
    if (!id || !task) return notFound(id ?? '')
    if (call.method === 'GET') return { status: 200, json: task }
    if (call.method === 'PATCH') {
      Object.assign(task, call.body)
      return { status: 200, json: task }
    }
    if (call.method === 'DELETE') {
      tasks.splice(index, 1)
      return { status: 204 }
    }
    return { status: 405, json: { error: 'method_not_allowed', message: 'Este método no está permitido.' } }
  }
}

async function fakeApi(page: Page, options: FakeOptions = {}) {
  const calls: Call[] = []
  const answer = tasksApi()
  await page.route(`${API}/**`, async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS })
      return
    }
    const url = new URL(request.url())
    const raw = request.postData()
    const call: Call = {
      method: request.method(),
      path: url.pathname,
      query: url.searchParams,
      sandboxId: request.headers()['x-sandbox-id'],
      body: raw ? JSON.parse(raw) : undefined,
    }
    calls.push(call)
    const n = calls.length
    if (options.gate) await options.gate
    const reply = options.reply?.(call, n) ?? answer(call)
    await route
      .fulfill({
        status: reply.status,
        headers: {
          ...CORS,
          'content-type': 'application/json; charset=utf-8',
          'x-response-time': '1.4ms',
          'x-ratelimit-limit': '60',
          'x-ratelimit-remaining': String(Math.max(0, 60 - n)),
          'x-ratelimit-reset': '60',
          ...reply.headers,
        },
        body: reply.json === undefined ? '' : JSON.stringify(reply.json),
      })
      // The console may have given up on this request already (timeout or "Cancelar").
      .catch(() => {})
  })
  return calls
}

/** Opens the console and waits until the island has its sandbox id (it is hydrated by then). */
async function open(page: Page): Promise<string> {
  await page.goto(PATH)
  test.skip(
    (await page.getByText('La consola no está disponible en esta copia del sitio.').count()) > 0,
    'built without PUBLIC_PLAYGROUND_API_URL',
  )
  const id = page.getByTestId('sandbox-id')
  await expect(id).toHaveText(UUID)
  return (await id.textContent()) ?? ''
}

const sendButton = (page: Page) => page.getByRole('button', { name: 'Enviar petición' })
const example = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const responseSection = (page: Page) => page.getByRole('region', { name: 'Respuesta', exact: true })
const statusRegion = (page: Page) => responseSection(page).getByRole('status')
/** Text shown in the response, not the copy the status region reads out. */
const shown = (page: Page, text: string) =>
  responseSection(page).getByText(text, { exact: true }).and(page.locator(':not([role="status"])'))
const responseBody = (page: Page) => page.getByRole('region', { name: 'Cuerpo de la respuesta' })
const historyItems = (page: Page) =>
  page.getByRole('region', { name: 'Historial', exact: true }).getByRole('listitem')

async function expectNoSeriousA11yIssues(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

test.describe('API Playground', () => {
  test('lists, filters, creates a task and opens it by id, all in the visitor sandbox', async ({ page }) => {
    const calls = await fakeApi(page)
    const sandboxId = await open(page)

    // Default example: the list, with its sort and page size written in the path.
    await expect(example(page, 'GET Listar tareas')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('Ruta')).toHaveValue('/api/v1/tasks?sort=createdAt:desc&limit=10')
    await sendButton(page).click()

    const response = responseSection(page)
    await expect(response.getByText('200', { exact: true })).toBeVisible()
    await expect(response.getByText('Correcto', { exact: true })).toBeVisible()
    await expect(responseBody(page)).toContainText('"title": "Documentar la API con OpenAPI"')
    await expect(response.getByText('1,4 ms')).toBeVisible()
    await expect(response.getByText('59 de 60')).toBeVisible()
    await expect(response.locator('pre').filter({ hasText: 'x-response-time: 1.4ms' })).toBeVisible()
    await expect(statusRegion(page)).toHaveText(/^Respuesta 200, Correcto, en \d+ ms\.$/)
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/v1/tasks', sandboxId })
    expect(calls[0]?.query.toString()).toBe('sort=createdAt%3Adesc&limit=10')

    // A filter rewrites the path, and the path drives the request.
    await page.getByLabel('Estado').selectOption({ label: 'Pendiente' })
    await expect(page.getByLabel('Ruta')).toHaveValue(
      '/api/v1/tasks?sort=createdAt:desc&limit=10&status=pending',
    )
    await sendButton(page).click()
    await expect.poll(() => calls.length).toBe(2)
    expect(calls[1]?.query.get('status')).toBe('pending')

    // Create: 201 with the new task and its Location.
    await example(page, 'POST Crear una tarea').click()
    await expect(page.getByLabel('Método')).toHaveValue('POST')
    const body = page.getByRole('textbox', { name: 'Cuerpo (JSON)' })
    await body.fill('{\n  "title": "Probar la consola",\n  "priority": "high"\n}')
    await expect(page.getByText('JSON válido')).toBeVisible()
    await sendButton(page).click()
    await expect(response.getByText('201', { exact: true })).toBeVisible()
    await expect(response.getByText('Creado', { exact: true })).toBeVisible()
    await expect(
      response.locator('pre').filter({ hasText: 'location: /api/v1/tasks/bbbbbbbb-' }),
    ).toBeVisible()
    expect(calls[2]).toMatchObject({
      method: 'POST',
      path: '/api/v1/tasks',
      sandboxId,
      body: { title: 'Probar la consola', priority: 'high' },
    })

    // View: the new task is offered first in the task picker.
    await example(page, 'GET Ver una tarea').click()
    const picker = page.getByLabel('Tarea', { exact: true })
    await expect(picker).toHaveValue('bbbbbbbb-0000-4000-8000-000000000001')
    await expect(page.getByLabel('Ruta')).toHaveValue('/api/v1/tasks/bbbbbbbb-0000-4000-8000-000000000001')
    await expect(picker.locator('option')).toContainText(['Elige una tarea', 'Probar la consola (bbbbbbbb)'])
    await picker.selectOption({ label: 'Diseñar el modelo de datos (aaaaaaaa)' })
    await expect(page.getByLabel('Ruta')).toHaveValue('/api/v1/tasks/aaaaaaaa-0000-4000-8000-000000000003')
    await sendButton(page).click()
    await expect(responseBody(page)).toContainText('"title": "Diseñar el modelo de datos"')
    expect(calls[3]).toMatchObject({
      method: 'GET',
      path: '/api/v1/tasks/aaaaaaaa-0000-4000-8000-000000000003',
    })

    // The history keeps every request, newest first, and shows any of them again.
    await expect(historyItems(page)).toHaveCount(4)
    await expect(historyItems(page).first()).toContainText('GET /api/v1/tasks/aaaaaaaa')
    await historyItems(page).nth(1).getByRole('button').click()
    await expect(historyItems(page).nth(1).getByRole('button')).toHaveAttribute('aria-current', 'true')
    await expect(response.getByText('201', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Método')).toHaveValue('POST')
    expect(calls).toHaveLength(4)
  })

  test('explains a validation error field by field, and checks the JSON before sending', async ({ page }) => {
    const calls = await fakeApi(page)
    await open(page)

    await example(page, 'POST Error de validación').click()
    await sendButton(page).click()

    const response = responseSection(page)
    await expect(response.getByText('400', { exact: true })).toBeVisible()
    await expect(response.getByText('Petición no válida', { exact: true })).toBeVisible()
    await expect(response.getByRole('heading', { name: 'Qué pasó' })).toBeVisible()
    await expect(shown(page, 'Hay datos que no son válidos. Revisa los campos marcados.')).toBeVisible()
    const fields = response.getByRole('list', { name: 'Campos con problemas' }).getByRole('listitem')
    await expect(fields).toHaveCount(3)
    await expect(fields.nth(0)).toContainText('title')
    await expect(fields.nth(0)).toContainText('El título debe tener al menos 3 caracteres.')
    await expect(fields.nth(1)).toContainText('priority')
    await expect(fields.nth(2)).toContainText('dueDate')
    await expect(response.getByText('invalid_request', { exact: true })).toBeVisible()
    await expect(statusRegion(page)).toContainText('Hay 3 campos con problemas.')

    // Broken JSON never leaves the browser: the error says where and why, and the focus goes there.
    const body = page.getByRole('textbox', { name: 'Cuerpo (JSON)' })
    await body.fill('{"title": "Hola",}')
    await expect(
      page.getByText(/El cuerpo no es un JSON válido \(línea 1, columna \d+\)\. Sobra una coma/),
    ).toBeVisible()
    await sendButton(page).click()
    await expect(body).toBeFocused()
    await expect(body).toHaveAttribute('aria-invalid', 'true')
    expect(calls).toHaveLength(1)

    await page.getByRole('button', { name: 'Formatear' }).click()
    await body.fill('{"title":"Hola"}')
    await page.getByRole('button', { name: 'Formatear' }).click()
    await expect(body).toHaveValue('{\n  "title": "Hola"\n}')
  })

  test('shows Retry-After and the rate limit on a 429', async ({ page }) => {
    await fakeApi(page, {
      reply: () => ({
        status: 429,
        headers: { 'retry-after': '42', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '42' },
        json: { error: 'rate_limited', message: 'Hiciste demasiadas peticiones. Intenta de nuevo en 42 s.' },
      }),
    })
    await open(page)
    await sendButton(page).click()

    const response = responseSection(page)
    await expect(response.getByText('429', { exact: true })).toBeVisible()
    await expect(response.getByText('Demasiadas peticiones', { exact: true })).toBeVisible()
    await expect(
      response.getByText('Espera 42 segundos antes de la siguiente petición (cabecera Retry-After).'),
    ).toBeVisible()
    await expect(response.getByText('0 de 60')).toBeVisible()
    await expect(response.locator('pre').filter({ hasText: 'retry-after: 42' })).toBeVisible()
    await expect(
      response.getByText(/La API acepta 60 peticiones por minuto desde cada conexión/),
    ).toBeVisible()
    await expect(statusRegion(page)).toContainText('Espera 42 segundos.')
  })

  test('says the API is waking up when the first answer is slow', async ({ page }) => {
    await page.clock.install()
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await fakeApi(page, { gate })
    await open(page)
    await sendButton(page).click()

    const response = responseSection(page)
    await expect(response.getByText('Esperando la respuesta')).toBeVisible()
    await expect(response).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByRole('button', { name: 'Enviando…' })).toHaveAttribute('aria-disabled', 'true')
    const waking = 'La API está despertando (plan gratuito de Render); puede tardar hasta un minuto.'
    await expect(shown(page, waking)).toHaveCount(0)

    await page.clock.fastForward(4000)
    await expect(shown(page, waking)).toBeVisible()
    await expect(statusRegion(page)).toHaveText(waking)

    release()
    await expect(response.getByText('200', { exact: true })).toBeVisible()
    await expect(response).toHaveAttribute('aria-busy', 'false')
    await expect(response.getByText(/^La API estaba dormida y tardó [\d,]+ s en arrancar\./)).toBeVisible()
  })

  test('gives up after 75 seconds and lets the visitor retry', async ({ page }) => {
    await page.clock.install()
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const calls = await fakeApi(page, { gate })
    await open(page)
    await sendButton(page).click()
    await expect(responseSection(page).getByText('Esperando la respuesta')).toBeVisible()

    await page.clock.fastForward(76_000)
    const response = responseSection(page)
    await expect(response.getByText('La API no respondió a tiempo')).toBeVisible()
    await expect(
      shown(page, 'La API no respondió en 75 segundos. Puede que siga despertando: vuelve a intentarlo.'),
    ).toBeVisible()
    await expect(historyItems(page).first()).toContainText('Sin respuesta a tiempo')

    release()
    await response.getByRole('button', { name: 'Reintentar' }).click()
    await expect(response.getByText('200', { exact: true })).toBeVisible()
    await expect.poll(() => calls.length).toBe(2)
    expect(calls[1]?.path).toBe('/api/v1/tasks')
    await expect(historyItems(page)).toHaveCount(2)
  })

  test('writes the equivalent curl and fetch, with the sandbox and safe quoting', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await fakeApi(page)
    const sandboxId = await open(page)

    await example(page, 'POST Crear una tarea').click()
    await page.getByRole('textbox', { name: 'Cuerpo (JSON)' }).fill(`{"title": "Revisar el 'deploy'"}`)

    const panel = page.getByRole('tabpanel')
    await expect(page.getByRole('tab', { name: 'curl' })).toHaveAttribute('aria-selected', 'true')
    const curl = [
      `curl -i -X POST 'https://playground.test/api/v1/tasks' \\`,
      `  -H 'Content-Type: application/json' \\`,
      `  -H 'X-Sandbox-Id: ${sandboxId}' \\`,
      `  --data '{"title":"Revisar el '\\''deploy'\\''"}'`,
    ].join('\n')
    await expect(panel).toHaveText(curl)

    await page.getByRole('button', { name: 'Copiar' }).click()
    await expect(page.getByRole('button', { name: 'Copiado' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(curl)

    // Arrow keys move between the tabs.
    await page.getByRole('tab', { name: 'curl' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'fetch (JavaScript)' })).toBeFocused()
    await expect(panel).toContainText(
      `const response = await fetch('https://playground.test/api/v1/tasks', {`,
    )
    await expect(panel).toContainText(`'X-Sandbox-Id': '${sandboxId}',`)
    await expect(panel).toContainText(`title: 'Revisar el \\'deploy\\'',`)

    // GET has no body, and the snippet follows the path as it is edited.
    await example(page, 'GET Estadísticas').click()
    await page.getByRole('tab', { name: 'curl' }).click()
    await expect(panel).toHaveText(
      `curl -i 'https://playground.test/api/v1/tasks/stats' \\\n  -H 'X-Sandbox-Id: ${sandboxId}'`,
    )
  })

  test('starts over with a new sandbox and an empty history', async ({ page }) => {
    const calls = await fakeApi(page)
    const first = await open(page)
    await sendButton(page).click()
    await expect(historyItems(page)).toHaveCount(1)

    // A reload keeps the sandbox and the history (sessionStorage).
    await page.reload()
    await expect(page.getByTestId('sandbox-id')).toHaveText(first)
    await expect(historyItems(page)).toHaveCount(1)
    await expect(responseSection(page).getByText('200', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Empezar de cero' }).click()
    const second = page.getByTestId('sandbox-id')
    await expect(second).toHaveText(UUID)
    await expect(second).not.toHaveText(first)
    await expect(page.getByText('Todavía no has enviado ninguna petición.')).toBeVisible()
    await expect(statusRegion(page)).toContainText('Tienes un sandbox nuevo')

    await sendButton(page).click()
    await expect.poll(() => calls.length).toBe(2)
    expect(calls[1]?.sandboxId).toBe(await second.textContent())
  })

  test('links to the Swagger documentation in a new tab', async ({ page }) => {
    await fakeApi(page)
    await open(page)
    const docs = page.getByRole('link', { name: /Ver la documentación \(Swagger\)/ })
    await expect(docs).toHaveAttribute('href', `${API}/docs`)
    await expect(docs).toHaveAttribute('target', '_blank')
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`answers fit the screen and are accessible in the ${theme} theme`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('aim-theme', t), theme)
      await fakeApi(page)
      await open(page)
      await sendButton(page).click()
      await expect(responseSection(page).getByText('200', { exact: true })).toBeVisible()
      await example(page, 'POST Error de validación').click()
      await sendButton(page).click()
      await expect(responseSection(page).getByRole('heading', { name: 'Qué pasó' })).toBeVisible()
      await page.getByRole('textbox', { name: 'Cuerpo (JSON)' }).fill('{')
      await expect(page.getByText(/El cuerpo no es un JSON válido/)).toBeVisible()

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0)
      await expectNoSeriousA11yIssues(page)
    })
  }
})
