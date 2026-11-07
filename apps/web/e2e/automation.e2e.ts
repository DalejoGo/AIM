import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { SAMPLE_LEADS, toLead } from '../src/features/automation/lead'
import { fakeTurnstile, TOKEN_PREFIX } from './fakes'

// The Lab demo "Automatización en vivo" against a simulated /api/automation/runs and a fake Turnstile. The runs
// are SSE bodies like the ones apps/edge writes (docs/AUTOMATIZACION.md): `run`, one `step` per step of the
// flow, then `done` or `error`. The flow runs in under a millisecond, so its times are 0 or 1.

const PAGE = '/lab/automatizacion-en-vivo/'
const RUN_ID = '0b7c6a2e-5f1d-4c3a-9e8b-7a6d5c4b3a21'
const WORKFLOW = 'https://github.com/DalejoGo/AIM/blob/main/automations/workflows/lead-demo.json'
const FLOW = 'Contacto → lead calificado'
const tokenPattern = new RegExp(`^${TOKEN_PREFIX}-\\d+$`)

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

const STEPS = {
  received: { step: 'received', data: { flow: FLOW }, atMs: 0 },
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
    atMs: 0,
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
    atMs: 0,
  },
  routed: {
    step: 'routed',
    data: { route: 'call', label: 'Llamada', sla: 'Llamada en menos de 24 horas' },
    atMs: 0,
  },
  drafted: {
    step: 'drafted',
    data: {
      subject: 'Laura, hablemos de tu automatización',
      body: 'Hola Laura:\n\nGracias por escribir a AIM. <b>Te llamamos</b> en menos de 24 horas.',
    },
    atMs: 1,
  },
  recorded: { step: 'recorded', data: { reference: 'AIM-0B7C6A2E' }, atMs: 1 },
  done: { step: 'done', data: { outcome: 'accepted' }, atMs: 1 },
}

const accepted = () =>
  [
    sse('run', { runId: RUN_ID }),
    ...Object.values(STEPS).map((step) => sse('step', step)),
    sse('done', { outcome: 'accepted', totalMs: 1 }),
  ].join('')

const rejected = () =>
  [
    sse('run', { runId: RUN_ID }),
    sse('step', STEPS.received),
    sse('step', {
      step: 'validated',
      data: {
        valid: false,
        checks: [
          { id: 'corporate_email', label: 'Correo corporativo', ok: true },
          { id: 'links', label: 'Sin enlaces sospechosos', ok: false },
        ],
      },
      atMs: 0,
    }),
    sse('step', { step: 'done', data: { outcome: 'rejected' }, atMs: 0 }),
    sse('done', { outcome: 'rejected', totalMs: 0 }),
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
const runSection = (page: Page) => page.getByRole('region', { name: 'Ejecución del flujo' })

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
})

test('presents the demo: what it proves, the test-data notice, the flow on GitHub and the seven steps', async ({
  page,
}) => {
  // The page calls no API until the visitor runs the flow.
  const apiCalls: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/automation')) apiCalls.push(request.url())
  })
  await open(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Automatización en vivo' })).toBeVisible()
  const proves = page.getByRole('region', { name: 'Qué demuestra' })
  await expect(proves.getByRole('listitem')).toHaveCount(5)
  await expect(proves).toContainText('Diseñado en n8n')
  await expect(proves).toContainText('Probado contra n8n real')
  await expect(proves).toContainText('Nada se guarda')
  await expect(proves).not.toContainText('Webhooks')
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
  expect(apiCalls).toEqual([])
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

  await expect(runSection(page).getByRole('heading', { name: 'Ejecución del flujo' })).toBeFocused({
    timeout: 1000,
  })
  await expect(step(page, 'received')).toHaveAttribute('data-status', 'done')
  await expect(step(page, 'received')).toContainText(`Flujo ${FLOW}`)
  await expect(step(page, 'received')).toContainText('menos de 1 ms')
  await expect(step(page, 'drafted')).toContainText('+1 ms')
  await expect(step(page, 'done')).toHaveAttribute('data-status', 'done')

  const result = runSection(page).locator('[tabindex="-1"]').filter({ hasText: 'Solicitud aceptada' })
  await expect(result).toBeFocused()
  await expect(result.locator('dt:text-is("Flujo") + dd')).toHaveText(`${FLOW} (diseñado en n8n)`)
  await expect(result.locator('dt:text-is("Referencia") + dd')).toHaveText('AIM-0B7C6A2E')
  await expect(result.locator('dt:text-is("Duración del flujo") + dd')).toHaveText('1 ms')
  // Measured by the browser, from the click until the result showed up.
  await expect(result.locator('dt:text-is("Del clic al resultado") + dd')).toHaveText(/^\d+,\d s$/)
  await expect(result.getByRole('link', { name: /Ver el flujo de n8n en GitHub/ })).toHaveAttribute(
    'href',
    WORKFLOW,
  )

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
    /^Listo: solicitud aceptada, prioridad alta\. El flujo tardó 1 ms; del clic al resultado, \d+,\d s\.$/,
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
  const result = runSection(page).locator('[tabindex="-1"]').filter({ hasText: 'Solicitud rechazada' })
  await expect(result.locator('dt:text-is("Duración del flujo") + dd')).toHaveText('menos de 1 ms')
  await expect(result.locator('dt:text-is("Del clic al resultado") + dd')).toHaveText(/^\d+,\d s$/)
  await expect(step(page, 'validated')).toContainText('No cumple: Sin enlaces sospechosos')
  await expect(step(page, 'validated')).toContainText('La solicitud no pasó la validación')
  for (const name of ['scored', 'routed', 'drafted', 'recorded']) {
    await expect(step(page, name)).toHaveAttribute('data-status', 'skipped')
  }
  await expect(step(page, 'done')).toHaveAttribute('data-status', 'done')
  expect(calls).toHaveLength(1)
  expect((calls[0] as { lead: { company?: string } }).lead.company).toBeUndefined()
})

test('"Detener" closes a run that is still open and keeps the steps that arrived', async ({ page }) => {
  const live = await liveRuns(page)
  await open(page)
  await runSample(page, 1)
  await live.opened()
  await live.push(sse('run', { runId: RUN_ID }) + sse('step', STEPS.received))
  await expect(step(page, 'received')).toHaveAttribute('data-status', 'done')
  await expect(step(page, 'validated')).toHaveAttribute('data-status', 'active')
  await page.getByRole('button', { name: 'Detener' }).click()

  await expect(runSection(page).getByText('Detuviste la ejecución.')).toBeVisible()
  expect(await live.aborted()).toBe(true)
  await expect(step(page, 'received')).toHaveAttribute('data-status', 'done')
  await expect(step(page, 'validated')).toHaveAttribute('data-status', 'pending')
  await expect(runButton(page)).toBeEnabled()
})

test('shows the steps that arrived and then the error when the flow fails', async ({ page }) => {
  const message = 'Algo falló de nuestro lado durante la ejecución. Inténtalo de nuevo en unos minutos.'
  await mockRuns(page, () => ({
    sse:
      sse('run', { runId: RUN_ID }) +
      sse('step', STEPS.received) +
      sse('error', { code: 'internal', message }),
  }))
  await open(page)
  await runSample(page, 1)

  const alert = runSection(page).getByRole('alert')
  await expect(alert).toHaveText(message)
  await expect(step(page, 'received')).toHaveAttribute('data-status', 'done')
  await expect(step(page, 'validated')).toHaveAttribute('data-status', 'pending')
  await expect(runButton(page)).toHaveText('Ejecutar otra vez')
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
      'a verification that could not be checked asks for it again',
      {
        status: 503,
        json: {
          error: 'captcha_unavailable',
          message: 'No pudimos revisar la verificación de seguridad. Inténtalo de nuevo.',
        },
      },
      'No pudimos revisar la verificación de seguridad. Inténtalo de nuevo.',
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

  test('a deploy without the API (404) pauses the demo and points to WhatsApp and the contact form', async ({
    page,
  }) => {
    await mockRuns(page, () => ({
      status: 404,
      json: { error: 'not_found', message: 'Esta ruta de la API no existe.' },
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
