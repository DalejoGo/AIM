import type { Page, Request, Route } from '@playwright/test'

/** Every token the fake widget hands out starts with this; the suffix counts renders and resets. */
export const TOKEN_PREFIX = 'e2e-token'

/**
 * Stand-in for Cloudflare's api.js: defines window.turnstile with the same render/reset/remove shape and
 * passes at once. Each render or reset hands out a new token, so tests can tell a reset happened.
 */
const FAKE_TURNSTILE = `
window.turnstile = (() => {
  let issued = 0
  let rendered = 0
  const widgets = new Map()
  // The current token is also written on the widget (data-token), so tests can wait for a new one.
  const pass = (widget) =>
    setTimeout(() => {
      const token = '${TOKEN_PREFIX}-' + ++issued
      widget.box.dataset.token = token
      widget.options.callback?.(token)
    }, 0)
  return {
    render(container, options) {
      const id = 'fake-' + ++rendered
      const box = document.createElement('p')
      box.textContent = 'Verificación simulada'
      container.append(box)
      const widget = { box, options }
      widgets.set(id, widget)
      pass(widget)
      return id
    },
    reset(id) {
      const widget = widgets.get(id)
      if (widget) pass(widget)
    },
    remove(id) {
      widgets.get(id)?.box.remove()
      widgets.delete(id)
    },
  }
})()
`

/** Serves the fake instead of the real script, so no test depends on Cloudflare. */
export async function fakeTurnstile(page: Page): Promise<void> {
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: FAKE_TURNSTILE }),
  )
}

export interface ApiCall {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
}

type Reply = { status: number; json?: unknown; headers?: Record<string, string> }
type Handler = (call: ApiCall, calls: ApiCall[]) => Reply | undefined

function toCall(request: Request): ApiCall {
  const url = new URL(request.url())
  const raw = request.postData()
  return {
    method: request.method(),
    path: url.pathname,
    query: url.searchParams,
    body: raw ? JSON.parse(raw) : undefined,
  }
}

/**
 * Intercepts /api/** with a handler and records every call. A handler that returns undefined answers 404
 * with an ApiError, like apps/edge does for unknown routes.
 */
export async function mockApi(page: Page, handler: Handler): Promise<ApiCall[]> {
  const calls: ApiCall[] = []
  await page.route('**/api/**', async (route: Route) => {
    const call = toCall(route.request())
    calls.push(call)
    const reply = handler(call, calls) ?? {
      status: 404,
      json: { error: 'not_found', message: 'Esta ruta de la API no existe.' },
    }
    await route.fulfill({
      status: reply.status,
      headers: reply.headers,
      contentType: 'application/json',
      body: reply.json === undefined ? '' : JSON.stringify(reply.json),
    })
  })
  return calls
}

export const unauthorized = { status: 401, json: { error: 'unauthorized', message: 'Tu sesión venció.' } }
export const invalidGrant = {
  status: 400,
  json: { error: 'invalid_grant', message: 'Tu sesión terminó. Inicia sesión de nuevo con tu correo.' },
}
