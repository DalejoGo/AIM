import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { fakeTurnstile, TOKEN_PREFIX } from './fakes'

// The Lab assistant against a simulated /api/assistant (page.route) and a fake Turnstile. The answers are
// SSE bodies like the ones apps/edge writes: several `delta` events, then `done` or `error`.

const WHATSAPP = 'https://wa.me/573027015524'
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
  /** The reply waits for this promise, so a test can look at the page while the answer is on its way. */
  wait?: Promise<unknown>
}

interface Handlers {
  /** Reply to the n-th session request (from 1). Default: 200. */
  session?: (n: number) => Reply
  /** Reply to the n-th question (from 1). */
  messages: (n: number) => Reply
}

interface Calls {
  session: { turnstileToken: string }[]
  messages: { messages: { role: string; content: string }[] }[]
}

async function mockAssistant(page: Page, handlers: Handlers): Promise<Calls> {
  const calls: Calls = { session: [], messages: [] }
  await page.route('**/api/assistant/*', async (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())
    let reply: Reply
    if (pathname === '/api/assistant/session') {
      calls.session.push(request.postDataJSON())
      reply = handlers.session?.(calls.session.length) ?? { json: { expiresIn: 1800 } }
    } else if (pathname === '/api/assistant/messages') {
      calls.messages.push(request.postDataJSON())
      reply = handlers.messages(calls.messages.length)
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

async function expectNoSeriousA11yIssues(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

/** Passes the gate: waits for the fake widget's token and starts the conversation. */
async function startChat(page: Page) {
  await page.goto('/lab/asistente-ia/')
  await expect(page.locator('[data-token]')).toHaveAttribute('data-token', tokenPattern)
  await page.getByRole('button', { name: 'Empezar a conversar' }).click()
  await expect(page.getByRole('textbox', { name: 'Tu pregunta' })).toBeFocused()
}

const log = (page: Page) => page.getByRole('log', { name: 'Mensajes de la conversación' })
const question = (page: Page) => page.getByRole('textbox', { name: 'Tu pregunta' })

test.beforeEach(async ({ page }) => {
  await fakeTurnstile(page)
})

test('presents the assistant, warns it is an AI and starts after the verification', async ({ page }) => {
  const calls = await mockAssistant(page, { messages: () => ({ sse: answer('Hola') }) })
  await page.goto('/lab/asistente-ia/')
  await expect(page.getByRole('heading', { name: 'Pregúntale al asistente' })).toBeVisible()
  await expect(page.getByText('Es una inteligencia artificial y puede equivocarse.')).toBeVisible()
  await expect(page.getByText(/Tus mensajes se procesan en Cloudflare Workers AI/)).toBeVisible()
  await expect(page.getByRole('link', { name: /Escribir por WhatsApp/ }).first()).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\//,
  )
  await expect(page.getByRole('link', { name: 'usar el formulario de contacto' })).toHaveAttribute(
    'href',
    '/contacto/',
  )
  await expect(page.locator('[data-token]')).toHaveAttribute('data-token', tokenPattern)
  await expectNoSeriousA11yIssues(page)

  await page.getByRole('button', { name: 'Empezar a conversar' }).click()
  await expect(question(page)).toBeFocused()
  expect(calls.session).toEqual([{ turnstileToken: expect.stringMatching(tokenPattern) }])
  for (const text of ['¿Cuánto cuesta una página web?', '¿Trabajas con clientes fuera de Colombia?']) {
    await expect(page.getByRole('button', { name: text })).toBeVisible()
  }
})

test('streams the answer with the safe format and keeps the conversation', async ({ page }) => {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const calls = await mockAssistant(page, {
    messages: (n) =>
      n === 1
        ? {
            wait: held,
            sse: answer(
              'Una **página web** arranca ',
              'desde **USD 250**. Incluye:\n\n- Diseño pensado para celular\n',
              '- Botón de WhatsApp\n\nCalcula tu rango en /cotizar/ o escríbele a David: ',
              `${WHATSAPP}. Más en [otro sitio](https://evil.example/) y [aquí](javascript:alert(1)).`,
              '\n\n<img src=x onerror="window.hacked=1">',
            ),
          }
        : { sse: answer('Sí, ', 'con gusto.') },
  })
  await startChat(page)

  await question(page).fill('¿Cuánto cuesta una página web?')
  await expect(page.getByText('30 de 1000 caracteres')).toBeVisible()
  await question(page).press('Enter')

  // While the answer is on its way: the indicator, the "Detener" button and the field ready for the next one.
  await expect(log(page).getByText('¿Cuánto cuesta una página web?')).toBeVisible()
  await expect(page.getByText('Escribiendo…')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Detener' })).toBeVisible()
  await expect(question(page)).toBeFocused()
  await expect(question(page)).toHaveValue('')
  await expect(page.getByText('0 de 1000 caracteres')).toBeVisible()
  release()

  const reply = log(page)
    .locator('div', { hasText: /^Asistente:/ })
    .last()
  await expect(reply.getByText('página web', { exact: true })).toBeVisible()
  await expect(page.getByText('Escribiendo…')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Enviar' })).toBeVisible()
  await expect(reply.locator('strong', { hasText: 'USD 250' })).toBeVisible()
  await expect(reply.getByRole('listitem')).toHaveText(['Diseño pensado para celular', 'Botón de WhatsApp'])
  const quote = reply.getByRole('link', { name: /\/cotizar\// })
  await expect(quote).toHaveAttribute('href', '/cotizar/')
  await expect(quote).toHaveAttribute('target', '_blank')
  await expect(reply.getByRole('link', { name: new RegExp(WHATSAPP) })).toHaveAttribute('href', WHATSAPP)
  // Only the site and WhatsApp become links; everything else, markup included, is text.
  await expect(reply.getByRole('link')).toHaveCount(2)
  await expect(reply).toContainText('otro sitio (https://evil.example/)')
  await expect(reply).toContainText('[aquí](javascript:alert(1))')
  await expect(reply).toContainText('<img src=x onerror="window.hacked=1">')
  await expect(reply.locator('img')).toHaveCount(0)
  expect(await page.evaluate(() => (window as { hacked?: number }).hacked)).toBeUndefined()
  expect(calls.messages[0]).toEqual({
    messages: [{ role: 'user', content: '¿Cuánto cuesta una página web?' }],
  })

  // Shift+Enter is a new line; Enter sends the whole question with the conversation so far.
  await question(page).pressSequentially('¿Y fuera')
  await question(page).press('Shift+Enter')
  await question(page).pressSequentially('de Colombia?')
  await expect(question(page)).toHaveValue('¿Y fuera\nde Colombia?')
  await question(page).press('Enter')
  await expect(log(page).getByText('Sí, con gusto.')).toBeVisible()
  const second = calls.messages[1]?.messages ?? []
  expect(second.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  expect(second[1]?.content).toContain('Una **página web** arranca desde **USD 250**.')
  expect(second[2]).toEqual({ role: 'user', content: '¿Y fuera\nde Colombia?' })
  await expectNoSeriousA11yIssues(page)

  await page.getByRole('button', { name: 'Nueva conversación' }).click()
  await expect(log(page)).toBeHidden()
  await expect(question(page)).toBeFocused()
  await expect(page.getByRole('button', { name: '¿Qué automatizaciones haces?' })).toBeVisible()
})

test('a suggestion sends its question', async ({ page }) => {
  const calls = await mockAssistant(page, {
    messages: () => ({ sse: answer('Automatizo procesos con n8n, ', 'Python y Node.js.') }),
  })
  await startChat(page)
  await page.getByRole('button', { name: '¿Qué automatizaciones haces?' }).click()

  await expect(log(page).getByText('Automatizo procesos con n8n, Python y Node.js.')).toBeVisible()
  expect(calls.messages).toEqual([{ messages: [{ role: 'user', content: '¿Qué automatizaciones haces?' }] }])
  await expect(page.getByRole('button', { name: '¿Cuánto cuesta una página web?' })).toHaveCount(0)
  await expect(question(page)).toBeFocused()
})

test('"Detener" stops the answer and keeps the chat usable', async ({ page }) => {
  let release = () => {}
  const never = new Promise<void>((resolve) => {
    release = resolve
  })
  const calls = await mockAssistant(page, { messages: () => ({ wait: never, sse: answer('Tarde') }) })
  await startChat(page)
  await question(page).fill('Hola')
  await question(page).press('Enter')
  // The next question, typed while the answer is on its way, is not sent by "Detener".
  await question(page).fill('Otra pregunta')
  await page.getByRole('button', { name: 'Detener' }).click()

  await expect(log(page).getByText('Detuviste la respuesta.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enviar' })).toBeFocused()
  await expect(question(page)).toHaveValue('Otra pregunta')
  expect(calls.messages).toHaveLength(1)
  release()
})

test('429 says how long to wait', async ({ page }) => {
  const limit =
    'Ya enviaste varios mensajes al asistente en la última hora. Vuelve a intentarlo en 12 minutos o escríbele a David por WhatsApp.'
  await mockAssistant(page, {
    messages: () => ({
      status: 429,
      headers: { 'Retry-After': '700' },
      json: { error: 'rate_limited', message: limit },
    }),
  })
  await startChat(page)
  await question(page).fill('Hola')
  await question(page).press('Enter')

  const alert = page.getByRole('alert').filter({ hasText: 'Vuelve a intentarlo en 12 minutos' })
  await expect(alert).toBeVisible()
  await expect(alert.getByRole('button', { name: 'Intentar de nuevo' })).toHaveCount(0)
  await expect(question(page)).toBeVisible()
  // The way out stays in the conversation.
  const conversation = page.getByRole('region', { name: 'Conversación' })
  await expect(conversation.getByRole('link', { name: /Escribir por WhatsApp/ })).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\//,
  )
  await expect(conversation.getByRole('link', { name: 'usar el formulario de contacto' })).toBeVisible()
  await expectNoSeriousA11yIssues(page)
})

test('503 pauses the assistant and shows the contact channels', async ({ page }) => {
  await mockAssistant(page, {
    messages: () => ({
      status: 503,
      json: { error: 'assistant_unavailable', message: 'El asistente no está disponible en este momento.' },
    }),
  })
  await startChat(page)
  await question(page).fill('Hola')
  await question(page).press('Enter')

  const pause = page.getByRole('alert')
  await expect(pause.getByRole('heading', { name: 'El asistente está en pausa' })).toBeVisible()
  await expect(pause).toBeFocused()
  await expect(pause.getByRole('link', { name: /Escribir por WhatsApp/ })).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\//,
  )
  await expect(pause.getByRole('link', { name: 'Ir al formulario de contacto' })).toHaveAttribute(
    'href',
    '/contacto/',
  )
  await expect(question(page)).toHaveCount(0)
  await expectNoSeriousA11yIssues(page)
})

test('503 at the gate shows the pause instead of the verification', async ({ page }) => {
  const calls = await mockAssistant(page, {
    session: () => ({ status: 503, json: { error: 'assistant_unavailable', message: 'No disponible.' } }),
    messages: () => ({ sse: answer('x') }),
  })
  await page.goto('/lab/asistente-ia/')
  await expect(page.locator('[data-token]')).toHaveAttribute('data-token', tokenPattern)
  await page.getByRole('button', { name: 'Empezar a conversar' }).click()

  await expect(page.getByRole('heading', { name: 'El asistente está en pausa' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Empezar a conversar' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Intentar de nuevo' }).click()
  await expect(page.getByRole('button', { name: 'Empezar a conversar' })).toBeVisible()
  expect(calls.messages).toHaveLength(0)
})

test('an error event shows its message, keeps the text so far and retries', async ({ page }) => {
  const failed =
    'El asistente no pudo terminar la respuesta. Inténtalo de nuevo o escríbele a David por WhatsApp o desde /contacto/.'
  const calls = await mockAssistant(page, {
    messages: (n) =>
      n === 1
        ? {
            sse:
              sse('delta', { text: 'Una página web ' }) +
              sse('error', { error: 'assistant_failed', message: failed }),
          }
        : { sse: answer('Una página web arranca desde USD 250.') },
  })
  await startChat(page)
  await question(page).fill('¿Cuánto cuesta una página web?')
  await question(page).press('Enter')

  const alert = page.getByRole('alert').filter({ hasText: failed })
  await expect(alert).toBeVisible()
  await expect(log(page).getByText('La respuesta quedó incompleta.')).toBeVisible()
  await expect(log(page).getByText('Una página web', { exact: true })).toBeVisible()

  await alert.getByRole('button', { name: 'Intentar de nuevo' }).click()
  await expect(log(page).getByText('Una página web arranca desde USD 250.')).toBeVisible()
  await expect(log(page).getByText('La respuesta quedó incompleta.')).toHaveCount(0)
  await expect(page.getByRole('alert').filter({ hasText: failed })).toHaveCount(0)
  expect(calls.messages[1]).toEqual(calls.messages[0])
})

test('an expired session asks for a new verification and sends the question again', async ({ page }) => {
  const calls = await mockAssistant(page, {
    messages: (n) =>
      n === 1
        ? {
            status: 401,
            json: { error: 'assistant_session_required', message: 'Tu sesión con el asistente venció.' },
          }
        : { sse: answer('Aquí sigo.') },
  })
  await startChat(page)
  await question(page).fill('Hola')
  await question(page).press('Enter')

  await expect(page.getByRole('alert')).toContainText('Tu sesión con el asistente venció.')
  const renew = page.getByRole('button', { name: 'Seguir conversando' })
  await expect(renew).toBeVisible()
  await expect(page.locator('[data-token]')).toHaveAttribute('data-token', tokenPattern)
  await renew.click()

  await expect(log(page).getByText('Aquí sigo.')).toBeVisible()
  await expect(question(page)).toBeVisible()
  expect(calls.session).toHaveLength(2)
  expect(calls.session[1]?.turnstileToken).not.toBe(calls.session[0]?.turnstileToken)
  expect(calls.messages).toHaveLength(2)
  expect(calls.messages[1]).toEqual(calls.messages[0])
})

test('a dropped connection explains what happened', async ({ page }) => {
  await mockAssistant(page, { messages: () => ({ sse: answer('x') }) })
  await startChat(page)
  await page.route('**/api/assistant/messages', (route) => route.abort('internetdisconnected'))
  await question(page).fill('Hola')
  await question(page).press('Enter')
  await expect(page.getByRole('alert')).toContainText(
    'No hay conexión con el asistente. Revisa tu internet e inténtalo de nuevo.',
  )
})
