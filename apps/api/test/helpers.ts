import { randomUUID } from 'node:crypto'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { createApp } from '../src/app.js'
import type { Clock } from '../src/common/clock.js'
import { type ApiConfig, loadConfig } from '../src/config.js'

/** A clock that only moves when the test says so. */
export class FakeClock implements Clock {
  constructor(private current = Date.parse('2026-11-06T12:00:00.000Z')) {}

  now(): number {
    return this.current
  }

  advance(ms: number): void {
    this.current += ms
  }
}

export const MINUTE = 60_000

export interface TestApp {
  app: NestExpressApplication
  clock: FakeClock
  http: ReturnType<typeof request>
  /** Supertest agent for one sandbox: every call carries its X-Sandbox-Id. */
  sandbox(id?: string): SandboxClient
}

export interface SandboxClient {
  id: string
  get(path: string): request.Test
  post(path: string, body?: object): request.Test
  patch(path: string, body?: object): request.Test
  delete(path: string): request.Test
}

/** The app with a fake clock and a rate limit high enough to never get in the way (unless overridden). */
export async function createTestApp(
  env: Record<string, string> = {},
  config?: Partial<ApiConfig>,
): Promise<TestApp> {
  const clock = new FakeClock()
  const app = await createApp({
    config: { ...loadConfig({ API_RATE_LIMIT: '100000', ...env }), ...config },
    clock,
    logger: false,
  })
  await app.init()
  const http = request(app.getHttpServer())

  const sandbox = (id: string = randomUUID()): SandboxClient => ({
    id,
    get: (path) => http.get(path).set('X-Sandbox-Id', id),
    post: (path, body) => http.post(path).set('X-Sandbox-Id', id).send(body),
    patch: (path, body) => http.patch(path).set('X-Sandbox-Id', id).send(body),
    delete: (path) => http.delete(path).set('X-Sandbox-Id', id),
  })

  return { app, clock, http, sandbox }
}

export const TASKS = '/api/v1/tasks'
