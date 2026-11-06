import { afterEach, describe, expect, it, vi } from 'vitest'
import { TASKS_REPOSITORY, type TasksRepository } from '../src/tasks/tasks.repository.js'
import { createTestApp, TASKS, type TestApp } from './helpers.js'

const RESPONSE_TIME = /^\d+(\.\d+)?ms$/

let t: TestApp | undefined

afterEach(async () => {
  await t?.app.close()
  t = undefined
})

describe('security headers (helmet)', () => {
  it('are set on API responses and errors', async () => {
    t = await createTestApp()
    for (const res of [
      await t.sandbox().get(TASKS),
      await t.http.get(TASKS),
      await t.http.get('/api/v1/nope'),
    ]) {
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN')
      expect(res.headers['strict-transport-security']).toContain('max-age=')
      expect(res.headers['content-security-policy']).toContain("default-src 'self'")
      // Dropped on purpose so /docs also works on http://localhost.
      expect(res.headers['content-security-policy']).not.toContain('upgrade-insecure-requests')
      expect(res.headers['x-powered-by']).toBeUndefined()
    }
  })
})

describe('X-Response-Time', () => {
  it('comes with every response, errors included', async () => {
    t = await createTestApp()
    const box = t.sandbox()
    for (const res of [
      await box.get(TASKS),
      await box.post(TASKS, { title: 'Con tiempo' }),
      await box.delete(`${TASKS}/00000000-0000-4000-8000-000000000000`),
      await t.http.get(TASKS),
      await t.http.get('/api/v1/health'),
    ]) {
      expect(res.headers['x-response-time']).toMatch(RESPONSE_TIME)
    }
  })
})

describe('CORS', () => {
  it('only allows the configured origins and exposes the headers the console reads', async () => {
    t = await createTestApp({ API_CORS_ORIGINS: 'https://aimweb.example, http://localhost:4321' })
    const allowed = await t.sandbox().get(TASKS).set('Origin', 'https://aimweb.example').expect(200)
    expect(allowed.headers['access-control-allow-origin']).toBe('https://aimweb.example')
    expect(allowed.headers['access-control-expose-headers']).toContain('X-Response-Time')
    expect(allowed.headers['access-control-expose-headers']).toContain('Retry-After')

    const preflight = await t.http
      .options(TASKS)
      .set('Origin', 'http://localhost:4321')
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', 'content-type,x-sandbox-id')
      .expect(204)
    expect(preflight.headers['access-control-allow-headers']).toContain('X-Sandbox-Id')
    expect(preflight.headers['access-control-allow-methods']).toContain('PATCH')

    const denied = await t.sandbox().get(TASKS).set('Origin', 'https://evil.example')
    expect(denied.headers['access-control-allow-origin']).toBeUndefined()
  })
})

describe('rate limit', () => {
  it('allows API_RATE_LIMIT requests per minute per IP across all routes, then 429 with Retry-After', async () => {
    t = await createTestApp({ API_RATE_LIMIT: '3' })
    const box = t.sandbox()
    await box.get(TASKS).expect(200)
    await box.get(`${TASKS}/stats`).expect(200)
    const third = await box.post(TASKS, { title: 'Tercera' }).expect(201)
    expect(third.headers['x-ratelimit-remaining']).toBe('0')

    const limited = await box.get(TASKS).expect(429)
    expect(limited.body).toEqual({
      error: 'rate_limited',
      message: expect.stringMatching(/^Hiciste demasiadas peticiones\. Intenta de nuevo en \d+ s\.$/),
    })
    const retryAfter = Number(limited.headers['retry-after'])
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(60)
    expect(limited.headers['x-response-time']).toMatch(RESPONSE_TIME)

    // Another sandbox from the same IP shares the budget.
    await t.sandbox().get(TASKS).expect(429)
    // Health checks are never limited.
    await t.http.get('/api/v1/health').expect(200)
  })

  it('tracks the visitor IP behind one proxy (X-Forwarded-For)', async () => {
    t = await createTestApp({ API_RATE_LIMIT: '1' })
    const box = t.sandbox()
    await box.get(TASKS).set('X-Forwarded-For', '203.0.113.10').expect(200)
    await box.get(TASKS).set('X-Forwarded-For', '203.0.113.10').expect(429)
    await box.get(TASKS).set('X-Forwarded-For', '203.0.113.11').expect(200)
  })
})

describe('unexpected errors', () => {
  it('answer 500 internal without leaking details', async () => {
    t = await createTestApp()
    const repository = t.app.get<TasksRepository>(TASKS_REPOSITORY, { strict: false })
    vi.spyOn(repository, 'list').mockRejectedValueOnce(
      new Error('connection refused: postgres://user:secret@db'),
    )

    const res = await t.sandbox().get(TASKS).expect(500)
    expect(res.body).toEqual({
      error: 'internal',
      message: 'Ocurrió un error inesperado. Intenta de nuevo en un momento.',
    })
    expect(JSON.stringify(res.body)).not.toContain('secret')
  })
})

describe('OpenAPI', () => {
  it('documents the tasks API with its schemas, examples and the X-Sandbox-Id header', async () => {
    t = await createTestApp()
    const doc = (await t.http.get('/docs-json').expect(200)).body

    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/health',
        '/api/v1/tasks',
        '/api/v1/tasks/stats',
        '/api/v1/tasks/{id}',
      ]),
    )
    expect(Object.keys(doc.paths['/api/v1/tasks'])).toEqual(expect.arrayContaining(['get', 'post']))
    expect(Object.keys(doc.paths['/api/v1/tasks/{id}'])).toEqual(
      expect.arrayContaining(['get', 'patch', 'delete']),
    )
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining(['Task', 'TaskPage', 'TaskStats', 'CreateTask', 'UpdateTask', 'ApiError']),
    )

    const list = doc.paths['/api/v1/tasks'].get
    const params = list.parameters.map((p: { name: string; in: string }) => `${p.in}:${p.name}`)
    expect(params).toEqual(
      expect.arrayContaining([
        'header:X-Sandbox-Id',
        'query:status',
        'query:priority',
        'query:q',
        'query:sort',
        'query:limit',
        'query:cursor',
      ]),
    )
    const header = list.parameters.find((p: { name: string }) => p.name === 'X-Sandbox-Id')
    expect(header).toMatchObject({ required: true, schema: { format: 'uuid' } })

    const create = doc.paths['/api/v1/tasks'].post
    expect(create.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/CreateTask',
    })
    expect(create.responses['201'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/Task',
    })
    expect(create.responses['409'].content['application/json'].example.error).toBe('sandbox_full')
    expect(doc.components.schemas.CreateTask.example.title).toEqual(expect.any(String))
    expect(doc.components.schemas.Task.example.id).toEqual(expect.any(String))
    expect(doc.components.schemas.CreateTask.properties.title).toMatchObject({ minLength: 3, maxLength: 120 })
  })

  it('serves Swagger UI at /docs', async () => {
    t = await createTestApp()
    const res = await t.http.get('/docs').redirects(1).expect(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.text).toContain('swagger-ui')
  })
})
