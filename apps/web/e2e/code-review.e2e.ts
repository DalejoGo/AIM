import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { EXAMPLES } from '../src/features/code-review/examples'
import { fakeTurnstile, TOKEN_PREFIX } from './fakes'

// The Lab code reviewer against a simulated /api/assistant (page.route) and a fake Turnstile. The reviews are
// SSE bodies like the ones apps/edge writes: several `delta` events, then `done` or `error`.

const PAGE = '/lab/revisor-de-codigo/'
const tokenPattern = new RegExp(`^${TOKEN_PREFIX}-\\d+$`)

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const answer = (...pieces: string[]) =>
  pieces.map((text) => sse('delta', { text })).join('') + sse('done', { reason: 'end_turn' })

interface Reply {
  status?: number
  /** An SSE body; otherwise `json` is sent. */
  sse?: string
  json?: unknown
  headers?: Record<string, string>
  /** The reply waits for this promise, so a test can look at the page while the review is on its way. */
  wait?: Promise<unknown>
}

interface Handlers {
  /** Reply to the n-th GET /api/assistant/session (from 1). Default: no session. */
  status?: (n: number) => Reply
  /** Reply to the n-th POST /api/assistant/session. Default: 200. */
  session?: (n: number) => Reply
  /** Reply to the n-th review. */
  review: (n: number) => Reply
}

interface Calls {
  status: number
  session: { turnstileToken: string }[]
  review: { language: string; code: string }[]
}

async function mockReviewer(page: Page, handlers: Handlers): Promise<Calls> {
  const calls: Calls = { status: 0, session: [], review: [] }
  await page.route('**/api/assistant/*', async (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())
    let reply: Reply
    if (pathname === '/api/assistant/session' && request.method() === 'GET') {
      calls.status += 1
      reply = handlers.status?.(calls.status) ?? { json: { active: false, expiresIn: 0 } }
    } else if (pathname === '/api/assistant/session') {
      calls.session.push(request.postDataJSON())
      reply = handlers.session?.(calls.session.length) ?? { json: { expiresIn: 1800 } }
    } else if (pathname === '/api/assistant/review') {
      calls.review.push(request.postDataJSON())
      reply = handlers.review(calls.review.length)
    } else {
      reply = { status: 404, json: { error: 'not_found', message: 'Esta ruta de la API no existe.' } }
    }
    if (reply.wait) await reply.wait
    await route
      .fulfill({
        status: reply.status ?? 200,
        headers: reply.headers,
        contentType: reply.sse === undefined ? 'application/json' : 'text/event-stream; charset=utf-8',
        body: reply.sse ?? JSON.stringify(reply.json ?? {}),
      })
      // "Detener" aborts the request before the reply: there is nothing left to fulfill.
      .catch(() => {})
  })
  return calls
}

const active = () => ({ json: { active: true, expiresIn: 1200 } })

async function expectNoSeriousA11yIssues(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

const code = (page: Page) => page.getByRole('textbox', { name: 'Tu código' })
const submit = (page: Page) => page.getByRole('button', { name: 'Revisar mi código' })
const result = (page: Page) => page.getByRole('region', { name: 'Revisión' })
const verification = (page: Page) => page.getByRole('group', { name: 'Verificación de seguridad' })

/** Waits until the island asked for the session, so what it shows next is the answer to that. */
async function open(page: Page, calls: Calls) {
  await page.goto(PAGE)
  await expect.poll(() => calls.status).toBe(1)
}

test.beforeEach(async ({ page }) => {
  await fakeTurnstile(page)
})

test('reviews pasted code after the verification, streaming the answer with the safe format', async ({
  page,
}) => {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const calls = await mockReviewer(page, {
    review: () => ({
      wait: held,
      sse: answer(
        '## Resumen\nCalcula el promedio, pero ',
        'falla con una lista vacía.\n\n## Riesgos\n- **División por cero** si `orders` está vacía.\n',
        '- El `except` se traga los errores. Más en [mi blog](https://evil.example/).\n\n',
        '## Pruebas sugeridas\n- `test_empty_orders_raises`\n\n## Mejoras\n```python\nif not orders:\n    return 0\n```\n',
        '<img src=x onerror="window.hacked=1">',
      ),
    }),
  })
  await open(page, calls)

  await expect(page.getByRole('heading', { name: 'Revisa tu código' })).toBeVisible()
  await expect(page.getByText('Es una inteligencia artificial y puede equivocarse.')).toBeVisible()
  await expect(
    page.getByText(/Tu código se procesa en Cloudflare Workers AI, con el modelo abierto Gemma/),
  ).toBeVisible()
  await expect(page.getByText(/no pegues secretos/)).toBeVisible()
  await expect(verification(page)).toBeVisible()
  await expect(page.locator('[data-token]')).toHaveAttribute('data-token', tokenPattern)
  await expectNoSeriousA11yIssues(page)

  const fragment = 'def average(orders):\n    return sum(orders) / len(orders)'
  await page.getByRole('combobox', { name: 'Lenguaje' }).selectOption('python')
  await code(page).fill(fragment)
  await expect(page.getByText(`${fragment.length} de 4000 caracteres`)).toBeVisible()
  await submit(page).click()

  // While the review is on its way: the indicator and the "Detener" button in place of the submit button.
  await expect(page.getByText('Escribiendo la revisión…')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Detener' })).toBeFocused()
  await expect(page.getByRole('status')).toHaveText('Revisando tu código.')
  release()

  const review = result(page)
  await expect(review.getByRole('heading', { level: 3 })).toHaveText([
    'Resumen',
    'Riesgos',
    'Pruebas sugeridas',
    'Mejoras',
  ])
  await expect(page.getByText('Escribiendo la revisión…')).toHaveCount(0)
  await expect(page.getByRole('status')).toHaveText('La revisión está lista, debajo del formulario.')
  await expect(submit(page)).toBeFocused()
  await expect(review.locator('strong', { hasText: 'División por cero' })).toBeVisible()
  await expect(review.locator('code', { hasText: 'test_empty_orders_raises' })).toBeVisible()
  await expect(review.locator('pre')).toHaveText('if not orders:\n    return 0')
  // Nothing from the model becomes markup or a link to another site.
  await expect(review.getByRole('link')).toHaveCount(0)
  await expect(review).toContainText('mi blog (https://evil.example/)')
  await expect(review).toContainText('<img src=x onerror="window.hacked=1">')
  await expect(review.locator('img')).toHaveCount(0)
  expect(await page.evaluate(() => (window as { hacked?: number }).hacked)).toBeUndefined()

  expect(calls.session).toEqual([{ turnstileToken: expect.stringMatching(tokenPattern) }])
  expect(calls.review).toEqual([{ language: 'python', code: fragment }])
  await expect(verification(page)).toHaveCount(0)
  await expectNoSeriousA11yIssues(page)

  await review.getByRole('button', { name: 'Revisar otro' }).click()
  await expect(result(page)).toHaveCount(0)
  await expect(code(page)).toHaveValue('')
  await expect(code(page)).toBeFocused()
  await expect(page.getByRole('combobox', { name: 'Lenguaje' })).toHaveValue('python')
})

test('a session from the assistant skips the verification, and an example loads with one click', async ({
  page,
}) => {
  const calls = await mockReviewer(page, {
    status: active,
    review: () => ({ sse: answer('## Resumen\n', 'El `except` se traga los errores.') }),
  })
  await open(page, calls)
  await expect(verification(page)).toHaveCount(0)

  const python = EXAMPLES.find((e) => e.language === 'python')
  if (!python) throw new Error('missing the Python example')
  await page.getByRole('button', { name: /^Python/ }).click()
  await expect(code(page)).toHaveValue(python.code)
  await expect(page.getByRole('combobox', { name: 'Lenguaje' })).toHaveValue('python')
  await expect(page.getByRole('status')).toHaveText(/Cargaste el ejemplo de Python/)

  await submit(page).click()
  await expect(result(page).getByText('se traga los errores.')).toBeVisible()
  expect(calls.review).toEqual([{ language: 'python', code: python.code }])
  expect(calls.session).toEqual([])
})

test('"Detener" stops the review and keeps the form usable', async ({ page }) => {
  let release = () => {}
  const never = new Promise<void>((resolve) => {
    release = resolve
  })
  const calls = await mockReviewer(page, {
    status: active,
    review: () => ({ wait: never, sse: answer('Tarde') }),
  })
  await open(page, calls)
  await code(page).fill('SELECT * FROM users')
  await submit(page).click()
  await page.getByRole('button', { name: 'Detener' }).click()

  await expect(result(page).getByText('Detuviste la revisión.')).toBeVisible()
  await expect(submit(page)).toBeFocused()
  release()
})

test('429 says how long to wait', async ({ page }) => {
  const limit =
    'Ya usaste varias veces el revisor o el asistente en la última hora: comparten el mismo límite. Vuelve a intentarlo en 12 minutos o escríbele a David por WhatsApp.'
  const calls = await mockReviewer(page, {
    status: active,
    review: () => ({
      status: 429,
      headers: { 'Retry-After': '700' },
      json: { error: 'rate_limited', message: limit },
    }),
  })
  await open(page, calls)
  await code(page).fill('x = 1 / 0')
  await submit(page).click()

  const alert = page.getByRole('alert').filter({ hasText: 'Vuelve a intentarlo en 12 minutos' })
  await expect(alert).toBeVisible()
  await expect(alert.getByRole('button', { name: 'Intentar de nuevo' })).toHaveCount(0)
  await expect(code(page)).toHaveValue('x = 1 / 0')
  await expect(submit(page)).toBeVisible()
  await expect(result(page)).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Escribir por WhatsApp/ }).first()).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\//,
  )
  await expectNoSeriousA11yIssues(page)
})

test('503 pauses the reviewer, keeps the code and shows the contact channels', async ({ page }) => {
  const calls = await mockReviewer(page, {
    status: active,
    review: () => ({
      status: 503,
      json: { error: 'assistant_unavailable', message: 'El revisor de código no está disponible.' },
    }),
  })
  await open(page, calls)
  await code(page).fill('x = 1 / 0')
  await submit(page).click()

  const pause = page.getByRole('alert')
  await expect(pause.getByRole('heading', { name: 'El revisor está en pausa' })).toBeVisible()
  await expect(pause).toBeFocused()
  await expect(pause.getByRole('link', { name: /Escribir por WhatsApp/ })).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\//,
  )
  await expect(pause.getByRole('link', { name: 'Ir al formulario de contacto' })).toHaveAttribute(
    'href',
    '/contacto/',
  )
  await expect(submit(page)).toHaveCount(0)
  await expect(code(page)).toHaveValue('x = 1 / 0')
  await expectNoSeriousA11yIssues(page)

  await pause.getByRole('button', { name: 'Intentar de nuevo' }).click()
  await expect(submit(page)).toBeVisible()
  expect(calls.status).toBe(2)
})

test('503 on arrival shows the pause before the visitor writes anything', async ({ page }) => {
  const calls = await mockReviewer(page, {
    status: () => ({ status: 503, json: { error: 'assistant_unavailable', message: 'No disponible.' } }),
    review: () => ({ sse: answer('x') }),
  })
  await open(page, calls)
  await expect(page.getByRole('heading', { name: 'El revisor está en pausa' })).toBeVisible()
  await expect(submit(page)).toHaveCount(0)
  await expect(verification(page)).toHaveCount(0)
})

test('an expired session asks for the verification again, then the review goes through', async ({ page }) => {
  const calls = await mockReviewer(page, {
    status: active,
    review: (n) =>
      n === 1
        ? { status: 401, json: { error: 'assistant_session_required', message: 'Tu sesión venció.' } }
        : { sse: answer('## Resumen\nTodo en orden.') },
  })
  await open(page, calls)
  await code(page).fill('SELECT 1')
  await submit(page).click()

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Tu sesión venció. Completa de nuevo la verificación de seguridad')
  await expect(alert).toBeFocused()
  await expect(verification(page)).toBeVisible()
  await expect(page.locator('[data-token]')).toHaveAttribute('data-token', tokenPattern)
  await submit(page).click()

  await expect(result(page).getByText('Todo en orden.')).toBeVisible()
  expect(calls.session).toHaveLength(1)
  expect(calls.review).toHaveLength(2)
  expect(calls.review[1]).toEqual(calls.review[0])
  await expect(verification(page)).toHaveCount(0)
})

test('an error event keeps the text so far, explains it and retries', async ({ page }) => {
  const failed =
    'El revisor no pudo terminar la revisión. Inténtalo de nuevo o escríbele a David por WhatsApp o desde /contacto/.'
  const calls = await mockReviewer(page, {
    status: active,
    review: (n) =>
      n === 1
        ? {
            sse:
              sse('delta', { text: '## Resumen\nUna consulta ' }) +
              sse('error', { error: 'assistant_failed', message: failed }),
          }
        : { sse: answer('## Resumen\nUna consulta con inyección SQL.') },
  })
  await open(page, calls)
  await code(page).fill("db.query('SELECT * FROM t WHERE id = ' + id)")
  await submit(page).click()

  const alert = page.getByRole('alert').filter({ hasText: failed })
  await expect(alert).toBeVisible()
  await expect(result(page).getByText('La revisión quedó incompleta.')).toBeVisible()
  await expect(result(page).getByText('Una consulta', { exact: true })).toBeVisible()

  await alert.getByRole('button', { name: 'Intentar de nuevo' }).click()
  await expect(result(page).getByText('Una consulta con inyección SQL.')).toBeVisible()
  await expect(result(page).getByText('La revisión quedó incompleta.')).toHaveCount(0)
  await expect(page.getByRole('alert').filter({ hasText: failed })).toHaveCount(0)
  expect(calls.review[1]).toEqual(calls.review[0])
})
