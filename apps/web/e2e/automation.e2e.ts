import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { SAMPLE_LEADS, toLead } from '../src/features/automation/lead'
import { fakeTurnstile, TOKEN_PREFIX } from './fakes'

// The Lab demo "Automatización en vivo" against a simulated /api/automation/runs and a fake Turnstile. The runs
// are SSE bodies like the ones apps/edge writes (docs/AUTOMATIZACION.md): `run`, `waking`…, `started`, one
// `step` per step n8n reports, then `done` or `error`.

const PAGE = '/lab/automatizacion-en-vivo/'
const RUN_ID = '0b7c6a2e-5f1d-4c3a-9e8b-7a6d5c4b3a21'
const WORKFLOW = 'https://github.com/DalejoGo/AIM/blob/main/automations/workflows/lead-demo.json'
const tokenPattern = new RegExp(`^${TOKEN_PREFIX}-\\d+$`)

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

const STEPS = {
  received: { step: 'received', data: { execution: '1042' }, atMs: 140 },
  validated: {
    step: 'validated',
    data: {
      valid: true,
      checks: [
        { id: 'corporate_email', label: 'Correo corporativo', ok: true },
        { id: 'detail', label: 'Mensaje con detalle', ok: true },
        { id: 'company', label: 'Empresa indicada', ok: true },
        { id: 'links', label: 'Sin enlaces sospechosos', ok: true },
      ],
    },
    atMs: 260,
  },
  scored: {
    step: 'scored',
    data: {
      score: 80,
      tier: 'hot',
      factors: [
        { label: 'Presupuesto de 500 a 2.000 USD', points: 15 },
        { label: 'Plazo urgente', points: 20 },
        { label: 'Servicio de automatización', points: 20 },
        { label: 'Correo corporativo', points: 10 },
        { label: 'Mensaje con detalle', points: 15 },
      ],
    },
    atMs: 390,
  },
  routed: {
    step: 'routed',
    data: { route: 'call', label: 'Llamada', sla: 'Llamada en menos de 24 horas' },
    atMs: 480,
  },
  drafted: {
    step: 'drafted',
    data: {
      subject: 'Laura, hablemos de tu automatización',
      body: 'Hola Laura:\n\nGracias por escribir a AIM. <b>Te llamamos</b> en menos de 24 horas.',
    },
    atMs: 610,
  },
  recorded: { step: 'recorded', data: { reference: 'AIM-0B7C6A2E' }, atMs: 720 },
  done: { step: 'done', data: { outcome: 'accepted' }, atMs: 805 },
}

const accepted = () =>
  [
    sse('run', { runId: RUN_ID }),
    sse('started', {}),
    ...Object.values(STEPS).map((step) => sse('step', step)),
    sse('done', { outcome: 'accepted', totalMs: 805 }),
  ].join('')

const rejected = () =>
  [
    sse('run', { runId: RUN_ID }),
    sse('started', {}),
    sse('step', { step: 'received', data: { execution: '1043' }, atMs: 120 }),
    sse('step', {
      step: 'validated',
      data: {
        valid: false,
        checks: [
          { id: 'corporate_email', label: 'Correo corporativo', ok: true },
          { id: 'links', label: 'Sin enlaces sospechosos', ok: false },
        ],
      },
      atMs: 230,
    }),
    sse('step', { step: 'done', data: { outcome: 'rejected' }, atMs: 300 }),
    sse('done', { outcome: 'rejected', totalMs: 300 }),
  ].join('')

interface Reply {
  status?: number
  sse?: string
  json?: unknown
  headers?: Record<string, string>
}

/** Answers POST /api/automation/runs with `reply(n)` for the n-th run, and records each body. */
async function mockRuns(page: Page, reply: (n: number) => Reply): Promise<unknown[]> {
  const calls: unknown[] = []
  await page.route('**/api/automation/runs', async (route) => {
    calls.push(route.request().postDataJSON())
    const answer = reply(calls.length)
    await route.fulfill({
      status: answer.status ?? 200,
      headers: answer.headers,
      contentType: answer.sse === undefined ? 'application/json' : 'text/event-stream; charset=utf-8',
      body: answer.sse ?? JSON.stringify(answer.json ?? {}),
    })
  })
  return calls
}

/**
 * Answers GET /api/automation/status with `reply(n)` for the n-th check (the page asks on load and every 5 s
 * while n8n wakes up). Registered again in a test, it replaces the default of the setup.
 */
async function mockStatus(
  page: Page,
  reply: (n: number) => Reply | 'abort',
): Promise<{ count: () => number }> {
  let count = 0
  await page.route('**/api/automation/status', async (route) => {
    const answer = reply(++count)
    if (answer === 'abort') return route.abort('connectionfailed')
    await route.fulfill({
      status: answer.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(answer.json ?? {}),
    })
  })
  return { count: () => count }
}

const WAKING_TEXT = 'Despertando n8n en el servidor gratuito…'
const READY_TEXT = 'n8n está listo: tu ejecución arrancará al instante.'
const wakeNotice = (page: Page) =>
  page
    .getByRole('region', { name: 'Solicitud de prueba' })
    .getByRole('status')
    .filter({ hasText: /Despertando n8n|n8n está listo/ })

interface LiveStream {
  /** Waits until the page opened the stream. */
  opened(): Promise<void>
  push(text: string): Promise<void>
  close(): Promise<void>
  /** Whether the page aborted its request ("Detener"). */
  aborted(): Promise<boolean>
}

/**
 * A run that stays open while the test looks at the page: fetch to /api/automation/runs gets a stream the test
 * writes to (route.fulfill can only send a whole body). Installed before the page loads.
 */
async function liveRuns(page: Page): Promise<LiveStream> {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window)
    type Live = { push?: (text: string) => void; close?: () => void; aborted: boolean }
    const live: Live = { aborted: false }
    ;(window as unknown as { __run: Live }).__run = live
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!new URL(url, location.href).pathname.endsWith('/api/automation/runs')) return original(input, init)
      const encoder = new TextEncoder()
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          live.push = (text) => controller.enqueue(encoder.encode(text))
          live.close = () => {
            // The page cancels the body itself once `done` arrives: closing it then is a no-op.
            try {
              controller.close()
            } catch {}
          }
          init?.signal?.addEventListener('abort', () => {
            live.aborted = true
            controller.error(new DOMException('The run was stopped', 'AbortError'))
          })
        },
      })
      return Promise.resolve(
        new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      )
    }
  })
  type Window = { __run: { push: (t: string) => void; close: () => void; aborted: boolean } }
  return {
    opened: async () => {
      await page.waitForFunction(() => Boolean((window as unknown as Window).__run.push))
    },
    push: (text) => page.evaluate((t) => (window as unknown as Window).__run.push(t), text),
    close: () => page.evaluate(() => (window as unknown as Window).__run.close()),
    aborted: () => page.evaluate(() => (window as unknown as Window).__run.aborted),
  }
}

async function expectNoSeriousA11yIssues(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

const field = (page: Page, label: string) => page.getByLabel(label, { exact: true })
const sampleButton = (page: Page) => page.getByRole('button', { name: 'Llenar con datos de ejemplo' })
const runButton = (page: Page) => page.getByRole('button', { name: /^Ejecutar (el flujo|otra vez)$/ })
const step = (page: Page, name: string) => page.locator(`li[data-step="${name}"]`)
const runSection = (page: Page) => page.getByRole('region', { name: 'Ejecución en n8n' })

/** Opens the page and waits for the fake widget's token. */
async function open(page: Page) {
  await page.goto(PAGE)
  await expect(page.locator('[data-token]')).toHaveAttribute('data-token', tokenPattern)
}

/** Loads the n-th example (from 1) and runs it. */
async function runSample(page: Page, n: number) {
  for (let i = 0; i < n; i++) await sampleButton(page).click()
  await expect(field(page, 'Nombre')).toHaveValue(SAMPLE_LEADS[n - 1]?.form.name ?? '')
  await runButton(page).click()
}

test.beforeEach(async ({ page }) => {
  await fakeTurnstile(page)
  // The page asks whether n8n is awake as soon as it opens; by default it is.
  await mockStatus(page, () => ({ json: { state: 'ready' } }))
})

test.describe('early wake-up of n8n', () => {
  test('starts waking n8n when the page opens, counts the wait and says when it is ready', async ({
    page,
  }) => {
    await page.clock.install()
    const status = await mockStatus(page, (n) => ({ json: { state: n === 1 ? 'waking' : 'ready' } }))
    await open(page)

    await expect(wakeNotice(page)).toContainText(WAKING_TEXT)
    await expect(wakeNotice(page)).toContainText('puedes ir llenando el formulario')
    await expect(wakeNotice(page)).toContainText(/0:0\d/)
    expect(status.count()).toBe(1)
    await expectNoSeriousA11yIssues(page)

    await page.clock.fastForward(5_000)
    await expect(wakeNotice(page)).toHaveText(READY_TEXT)
    expect(status.count()).toBe(2)
    await page.clock.fastForward(30_000)
    expect(status.count()).toBe(2)
    await expectNoSeriousA11yIssues(page)
  })

  test('stops asking once a run starts: the run reports its own wait', async ({ page }) => {
    await page.clock.install()
    const status = await mockStatus(page, () => ({ json: { state: 'waking' } }))
    await mockRuns(page, () => ({ sse: accepted() }))
    await open(page)
    await expect(wakeNotice(page)).toContainText(WAKING_TEXT)

    await runSample(page, 1)
    await expect(wakeNotice(page)).toHaveCount(0)
    const asked = status.count()
    await page.clock.fastForward(30_000)
    expect(status.count()).toBe(asked)
  })

  for (const [name, reply] of [
    ['the demo is disabled', { json: { state: 'disabled' } }],
    ['the API fails', { status: 500, json: { error: 'internal', message: 'Algo falló.' } }],
    ['there is no connection', 'abort'],
  ] as const) {
    test(`shows nothing when ${name}`, async ({ page }) => {
      const status = await mockStatus(page, () => reply)
      await open(page)
      await expect.poll(() => status.count()).toBe(1)
      await expect(page.getByText(WAKING_TEXT)).toHaveCount(0)
      await expect(page.getByText(READY_TEXT)).toHaveCount(0)
      await expect(wakeNotice(page)).toHaveCount(0)
      await expectNoSeriousA11yIssues(page)
    })
  }
})

test('presents the demo: what it proves, the test-data notice, the flow on GitHub and the seven steps', async ({
  page,
}) => {
  await open(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Automatización en vivo' })).toBeVisible()
  const proves = page.getByRole('region', { name: 'Qué demuestra' })
  await expect(proves.getByRole('listitem')).toHaveCount(4)
  await expect(proves).toContainText('Webhooks')
  await expect(proves).toContainText('n8n sin secretos')
  await expect(proves.getByRole('link', { name: /Mira el flujo de n8n en GitHub/ })).toHaveAttribute(
    'href',
    WORKFLOW,
  )
  await expect(page.getByText('Usa datos de prueba: el correo no se envía, solo se muestra.')).toBeVisible()

  const steps = runSection(page).getByRole('list', { name: 'Pasos del flujo' }).getByRole('listitem')
  await expect(steps).toHaveCount(7)
  for (const name of ['received', 'validated', 'scored', 'routed', 'drafted', 'recorded', 'done']) {
    await expect(step(page, name)).toHaveAttribute('data-status', 'pending')
  }
  await expect(page.getByRole('combobox', { name: 'Servicio' }).getByRole('option')).toHaveText([
    'Elige un servicio',
    'Páginas web',
    'Automatizaciones',
    'Aplicativos web',
    'Chatbots',
    'Blogs y contenido web',
  ])
  await expectNoSeriousA11yIssues(page)
})

test('checks the form before sending anything', async ({ page }) => {
  const calls = await mockRuns(page, () => ({ sse: accepted() }))
  await open(page)
  await runButton(page).click()

  await expect(field(page, 'Nombre')).toBeFocused()
  await expect(page.getByText('Escribe un nombre de 2 a 80 caracteres.')).toBeVisible()
  await expect(page.getByText('Escribe un correo válido, por ejemplo laura@empresa.co.')).toBeVisible()
  await expect(page.getByText('Elige uno de los servicios de la lista.')).toBeVisible()
  await expect(field(page, 'Correo')).toHaveAttribute('aria-invalid', 'true')
  expect(calls).toEqual([])

  await field(page, 'Nombre').fill('Ana')
  await expect(page.getByText('Escribe un nombre de 2 a 80 caracteres.')).toHaveCount(0)
})

test('runs the hot example: the steps light up one by one with their panels and the result', async ({
  page,
}) => {
  const calls = await mockRuns(page, () => ({ sse: accepted() }))
  await open(page)
  await runSample(page, 1)

  await expect(runSection(page).getByRole('heading', { name: 'Ejecución en n8n' })).toBeFocused({
    timeout: 1000,
  })
  // Paced: the first step shows before the last one.
  await expect(step(page, 'received')).toHaveAttribute('data-status', 'done')
  await expect(step(page, 'received')).toContainText('Ejecución n8n #1042')
  await expect(step(page, 'received')).toContainText('+0,1 s')
  await expect(step(page, 'done')).toHaveAttribute('data-status', 'done')

  const result = runSection(page).locator('[tabindex="-1"]').filter({ hasText: 'Solicitud aceptada' })
  await expect(result).toBeFocused()
  await expect(result).toContainText('Ejecución n8n #1042')
  await expect(result).toContainText('AIM-0B7C6A2E')
  await expect(result).toContainText('0,8 s')
  await expect(result.getByRole('link', { name: /Ver el flujo de n8n en GitHub/ })).toHaveAttribute(
    'href',
    WORKFLOW,
  )
  await expect(result).not.toContainText('Despertar n8n')

  await expect(step(page, 'validated').getByRole('listitem')).toHaveCount(4)
  await expect(step(page, 'validated')).toContainText('4 de 4 reglas cumplidas')
  await expect(step(page, 'scored')).toContainText('80 de 100 puntos')
  await expect(step(page, 'scored')).toContainText('Prioridad alta')
  await expect(step(page, 'scored')).toContainText('+20')
  await expect(step(page, 'routed')).toContainText('Llamada en menos de 24 horas')
  // The drafted e-mail is text: its markup shows as typed and never becomes an element.
  const preview = step(page, 'drafted').getByRole('figure')
  await expect(preview).toContainText('Vista previa del correo. No se envía.')
  await expect(preview).toContainText('Laura, hablemos de tu automatización')
  await expect(preview).toContainText('<b>Te llamamos</b>')
  await expect(preview.locator('b')).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Listo:' })).toHaveText(
    'Listo: solicitud aceptada, prioridad alta. El flujo tardó 0,8 s.',
  )

  const sample = SAMPLE_LEADS[0]
  if (!sample) throw new Error('missing the hot example')
  expect(calls).toEqual([{ turnstileToken: expect.stringMatching(tokenPattern), lead: toLead(sample.form) }])
  await expect(runButton(page)).toHaveText('Ejecutar otra vez')
  await expectNoSeriousA11yIssues(page)
})

test('runs the rejected example: validation fails and the middle steps are skipped', async ({ page }) => {
  const calls = await mockRuns(page, () => ({ sse: rejected() }))
  await open(page)
  await runSample(page, 3)

  await expect(runSection(page).getByText('Solicitud rechazada', { exact: true })).toBeVisible()
  await expect(step(page, 'validated')).toContainText('No cumple: Sin enlaces sospechosos')
  await expect(step(page, 'validated')).toContainText('La solicitud no pasó la validación')
  for (const name of ['scored', 'routed', 'drafted', 'recorded']) {
    await expect(step(page, name)).toHaveAttribute('data-status', 'skipped')
  }
  await expect(step(page, 'done')).toHaveAttribute('data-status', 'done')
  expect(calls).toHaveLength(1)
  expect((calls[0] as { lead: { company?: string } }).lead.company).toBeUndefined()
})

test('says honestly that n8n is waking up, counts the wait, then runs the flow', async ({ page }) => {
  const live = await liveRuns(page)
  await open(page)
  await runSample(page, 2)
  await live.opened()
  await live.push(sse('run', { runId: RUN_ID }) + sse('waking', { elapsedMs: 42_000 }))

  const waking = runSection(page).getByText(
    'El servidor gratuito de n8n estaba dormido; despertarlo tarda 1–2 minutos.',
  )
  await expect(waking).toBeVisible()
  await expect(runSection(page)).toContainText(/Esperando: 4\d s/)
  await expect(page.getByRole('button', { name: 'Detener' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'estaba dormido' })).toBeAttached()
  await expectNoSeriousA11yIssues(page)

  await live.push(sse('waking', { elapsedMs: 78_000 }))
  await expect(runSection(page)).toContainText(/Esperando: 1 min 1\d s/)

  await live.push(
    sse('started', {}) +
      sse('step', STEPS.received) +
      sse('step', { ...STEPS.done, data: { outcome: 'accepted' }, atMs: 200 }) +
      sse('done', { outcome: 'accepted', totalMs: 200 }),
  )
  await live.close()
  await expect(waking).toHaveCount(0)
  const result = runSection(page).locator('[tabindex="-1"]').filter({ hasText: 'Solicitud aceptada' })
  await expect(result).toContainText('Despertar n8n')
  await expect(result).toContainText(/1 min 1\d s/)
})

test('"Detener" closes the run while n8n wakes up', async ({ page }) => {
  const live = await liveRuns(page)
  await open(page)
  await runSample(page, 1)
  await live.opened()
  await live.push(sse('run', { runId: RUN_ID }) + sse('waking', { elapsedMs: 6000 }))
  await page.getByRole('button', { name: 'Detener' }).click()

  await expect(runSection(page).getByText('Detuviste la ejecución.')).toBeVisible()
  expect(await live.aborted()).toBe(true)
  await expect(runButton(page)).toBeEnabled()
})

test('shows the steps that arrived and then the error when the flow times out', async ({ page }) => {
  await mockRuns(page, () => ({
    sse:
      sse('run', { runId: RUN_ID }) +
      sse('started', {}) +
      sse('step', STEPS.received) +
      sse('error', {
        code: 'timeout',
        message: 'n8n no terminó el flujo a tiempo. Inténtalo de nuevo en unos minutos.',
      }),
  }))
  await open(page)
  await runSample(page, 1)

  const alert = runSection(page).getByRole('alert')
  await expect(alert).toHaveText('n8n no terminó el flujo a tiempo. Inténtalo de nuevo en unos minutos.')
  await expect(step(page, 'received')).toHaveAttribute('data-status', 'done')
  await expect(step(page, 'validated')).toHaveAttribute('data-status', 'pending')
  await expect(runButton(page)).toHaveText('Ejecutar otra vez')
})

test('says n8n could not be woken up', async ({ page }) => {
  const message = 'El servidor de n8n no despertó a tiempo. Inténtalo de nuevo en unos minutos.'
  await mockRuns(page, () => ({
    sse:
      sse('run', { runId: RUN_ID }) +
      sse('waking', { elapsedMs: 0 }) +
      sse('error', { code: 'n8n_unreachable', message }),
  }))
  await open(page)
  await runSample(page, 1)
  await expect(runSection(page).getByRole('alert')).toHaveText(message)
  await expectNoSeriousA11yIssues(page)
})

test('puts the API field errors under their inputs', async ({ page }) => {
  await mockRuns(page, () => ({
    status: 400,
    json: {
      error: 'invalid_request',
      message: 'Revisa los datos marcados e inténtalo de nuevo.',
      fields: { 'lead.email': ['Ese dominio no recibe correo.'] },
    },
  }))
  await open(page)
  await runSample(page, 1)
  await expect(page.getByText('Ese dominio no recibe correo.')).toBeVisible()
  await expect(field(page, 'Correo')).toBeFocused()
})

test.describe('refusals before the run', () => {
  for (const [name, reply, text] of [
    [
      'a refused verification asks for it again',
      {
        status: 403,
        json: { error: 'captcha_failed', message: 'No pudimos confirmar que eres una persona.' },
      },
      'No pudimos confirmar que eres una persona.',
    ],
    [
      'the visitor limit says how long to wait',
      {
        status: 429,
        headers: { 'Retry-After': '420' },
        json: {
          error: 'rate_limited',
          message: 'Ya ejecutaste la demo 3 veces hace poco. Vuelve a intentarlo en 7 minutos.',
        },
      },
      'Ya ejecutaste la demo 3 veces hace poco. Vuelve a intentarlo en 7 minutos.',
    ],
    [
      'the daily cap',
      {
        status: 503,
        json: { error: 'daily_limit', message: 'La demo llegó a su límite de ejecuciones por hoy.' },
      },
      'La demo llegó a su límite de ejecuciones por hoy.',
    ],
  ] as const) {
    test(name, async ({ page }) => {
      await mockRuns(page, () => reply)
      await open(page)
      const first = await page.locator('[data-token]').getAttribute('data-token')
      await runSample(page, 1)
      const alert = page.getByRole('form', { name: 'Solicitud de prueba' }).getByRole('alert')
      await expect(alert).toHaveText(text)
      await expect(alert).toBeFocused()
      // The token was spent: the widget hands out a new one for the next try.
      await expect(page.locator('[data-token]')).not.toHaveAttribute('data-token', first ?? '')
    })
  }

  test('a paused demo points to WhatsApp and the contact form', async ({ page }) => {
    await mockRuns(page, () => ({
      status: 503,
      json: { error: 'automation_unavailable', message: 'No disponible.' },
    }))
    await open(page)
    await runSample(page, 1)
    await expect(runSection(page).getByRole('heading', { name: 'La demo está en pausa' })).toBeVisible()
    await expect(runSection(page).getByRole('link', { name: /Escribir por WhatsApp/ })).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\//,
    )
    await expect(
      runSection(page).getByRole('link', { name: 'Ir al formulario de contacto' }),
    ).toHaveAttribute('href', '/contacto/')
  })
})

test('fits a 320 px screen after a run', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the mobile project is 320 px wide')
  await mockRuns(page, () => ({ sse: accepted() }))
  await open(page)
  await runSample(page, 1)
  await expect(step(page, 'done')).toHaveAttribute('data-status', 'done')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0)
})
