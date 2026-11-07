import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv, Deps } from './deps'
import { fail } from './lib/http'
import { log } from './lib/log'
import { apiHeaders, clientIp, sameOrigin } from './middleware/security'
import { adminRoutes } from './routes/admin'
import { assistantRoutes } from './routes/assistant'
import { authRoutes } from './routes/auth'
import { automationRoutes } from './routes/automation'
import { labRoutes } from './routes/lab'
import { leadRoutes } from './routes/leads'

/** The part of the Workers execution context the API uses. */
export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void
}

export type ResolveDeps = (c: {
  env: unknown
  executionCtx?: WaitUntil
}) => Promise<Deps & { dispose?: () => Promise<void> }>

/**
 * The edge API (DEC-014), mounted at /api by the Pages Function in apps/web/functions.
 * `resolveDeps` builds real adapters in production (src/runtime.ts) and PGlite + fakes in tests.
 */
export function createApp(resolveDeps: ResolveDeps) {
  const app = new Hono<AppEnv>().basePath('/api')

  app.use(async (c, next) => {
    const { dispose, ...resolved } = await resolveDeps({ env: c.env, executionCtx: tryExecutionCtx(c) })
    // Work that outlives the response (notifications, a streamed answer) may still use the request's resources,
    // so they are released only after it settles.
    const background: Promise<unknown>[] = []
    const deps: Deps = {
      ...resolved,
      waitUntil: (promise) => {
        background.push(promise)
        resolved.waitUntil(promise)
      },
    }
    c.set('deps', deps)
    try {
      await next()
    } finally {
      if (dispose) resolved.waitUntil(Promise.allSettled(background).then(() => dispose()))
    }
  })
  app.use(apiHeaders, clientIp, sameOrigin)

  app.get('/health', (c) => c.json({ status: 'ok' }))
  app.route('/leads', leadRoutes)
  app.route('/auth', authRoutes)
  app.route('/admin', adminRoutes)
  app.route('/assistant', assistantRoutes)
  app.route('/lab', labRoutes)
  app.route('/automation', automationRoutes)

  app.notFound((c) => fail(c, 404, 'not_found', 'Esta ruta de la API no existe.'))
  app.onError((err, c) => {
    // Hono raises HTTPException for client errors it detects itself (e.g. a malformed JSON body).
    if (err instanceof HTTPException && err.status < 500) {
      return fail(
        c,
        err.status,
        'invalid_request',
        'El cuerpo de la solicitud no es válido. Revisa los datos y vuelve a enviarlos.',
      )
    }
    log.error('unhandled', err)
    return fail(c, 500, 'internal', 'Algo falló de nuestro lado. Inténtalo de nuevo en unos minutos.')
  })

  return app
}

function tryExecutionCtx(c: { executionCtx: WaitUntil }): WaitUntil | undefined {
  try {
    return c.executionCtx
  } catch {
    // Outside Workers (tests) Hono throws when there is no execution context.
    return undefined
  }
}
