import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { onTestFinished } from 'vitest'
import { fixedCaptcha } from '../src/adapters/captcha'
import { memoryMailer } from '../src/adapters/mail'
import { createApp } from '../src/app'
import * as schema from '../src/db/schema'
import type { Db, Deps } from '../src/deps'
import { EdgeEnv } from '../src/env'

export const SITE = 'https://aim.test'

export const testEnv = EdgeEnv.parse({
  APP_ENV: 'development',
  SITE_ORIGIN: SITE,
  DATABASE_URL: 'postgres://unused',
  JWT_SECRET: 'test-secret-test-secret-test-secret!',
  ADMIN_EMAILS: 'admin@aim.test, Second@AIM.test',
  TURNSTILE_SECRET: 'test',
  MAIL_FROM: 'AIM <avisos@aim.test>',
  NOTIFY_TO: 'david@aim.test',
})

let template: Promise<PGlite> | undefined

/** Migrates one PGlite per test worker; every test then gets a clone (much cheaper than migrating again). */
function migratedTemplate(): Promise<PGlite> {
  template ??= (async () => {
    const pg = new PGlite()
    await migrate(drizzle(pg, { schema }), { migrationsFolder: join(import.meta.dirname, '../drizzle') })
    return pg
  })()
  return template
}

/** Databases still open in this worker; test/setup.ts closes them so memory does not pile up. */
export const openDatabases = new Set<PGlite>()

/**
 * A fresh in-memory Postgres (PGlite) with every migration applied. Created inside a test, it is closed when
 * that test ends; created in beforeAll/beforeEach, it is closed after the file.
 */
export async function testDb(): Promise<Db> {
  const pg = (await (await migratedTemplate()).clone()) as PGlite
  openDatabases.add(pg)
  try {
    onTestFinished(async () => {
      openDatabases.delete(pg)
      await pg.close()
    })
  } catch {
    // Not inside a test (beforeAll): test/setup.ts closes it in afterAll.
  }
  return drizzle(pg, { schema }) as unknown as Db
}

export interface TestContext {
  app: ReturnType<typeof createApp>
  db: Db
  mailer: ReturnType<typeof memoryMailer>
  clock: { now: Date }
  /** Requests whose resources were released, as the runtime does once the response and its background work end. */
  disposed: { count: number }
  /** Awaits work scheduled with waitUntil (notifications). */
  settle: () => Promise<void>
  request: (path: string, init?: RequestInit & { ip?: string; origin?: string | null }) => Promise<Response>
}

export interface TestOverrides extends Partial<Pick<Deps, 'captcha' | 'llm'>> {
  env?: Partial<EdgeEnv>
}

/** Without `llm` the context behaves like production without ANTHROPIC_API_KEY. */
export async function createTestContext(overrides: TestOverrides = {}): Promise<TestContext> {
  const db = await testDb()
  const mailer = memoryMailer()
  const clock = { now: new Date('2026-11-06T15:00:00Z') }
  const pending: Promise<unknown>[] = []
  const disposed = { count: 0 }
  const env: EdgeEnv = { ...testEnv, ...overrides.env }
  const app = createApp(async () => {
    // Like the runtime's per-request connection: unusable once the request is disposed.
    let closed = false
    const requestDb = new Proxy(db, {
      get(target, prop) {
        if (closed) throw new Error('the database connection of this request was already closed')
        const value = Reflect.get(target, prop, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    return {
      env,
      db: async () => requestDb,
      mailer,
      captcha: overrides.captcha ?? fixedCaptcha(true),
      ...(overrides.llm ? { llm: overrides.llm } : {}),
      now: () => clock.now,
      waitUntil: (p) => {
        pending.push(p)
      },
      dispose: async () => {
        closed = true
        disposed.count++
      },
    }
  })

  return {
    app,
    db,
    mailer,
    clock,
    disposed,
    settle: async () => {
      await Promise.all(pending.splice(0))
    },
    request: (path, { ip = '203.0.113.7', origin = SITE, headers, ...init } = {}) => {
      const h = new Headers(headers)
      h.set('cf-connecting-ip', ip)
      if (origin) h.set('origin', origin)
      if (init.body && !h.has('content-type')) h.set('content-type', 'application/json')
      return Promise.resolve(app.request(path, { ...init, headers: h }))
    },
  }
}

/** POST /api/assistant/session with a Turnstile token (the fake captcha decides whether it passes). */
export function startAssistantSession(t: TestContext, body: unknown = { turnstileToken: 'turnstile-token' }) {
  return t.request('/api/assistant/session', { method: 'POST', body: JSON.stringify(body) })
}

/** The `name=value` part of the assistant's session cookie, as the browser would send it back. */
export async function assistantCookie(t: TestContext): Promise<string> {
  const res = await startAssistantSession(t)
  if (res.status !== 200) throw new Error(`the session was refused with ${res.status}`)
  const cookie = res.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('no session cookie')
  return cookie
}

export interface SseEvent {
  event: string | undefined
  data: Record<string, unknown>
}

/** The events of a Server-Sent Events body, with their JSON data parsed. */
export function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      const lines = block.split('\n')
      const data = lines
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('\n')
      return { event: lines.find((l) => l.startsWith('event: '))?.slice(7), data: JSON.parse(data) }
    })
}
