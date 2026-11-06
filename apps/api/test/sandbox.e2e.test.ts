import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, MINUTE, TASKS, type TestApp } from './helpers.js'

let t: TestApp

beforeEach(async () => {
  t = await createTestApp()
})

afterEach(async () => {
  await t.app.close()
})

describe('X-Sandbox-Id', () => {
  it('is required', async () => {
    const res = await t.http.get(TASKS).expect(400)
    const message =
      'Falta la cabecera X-Sandbox-Id. Envía un UUID propio (por ejemplo, el que genera crypto.randomUUID()) ' +
      'para tener tu espacio de pruebas.'
    expect(res.body).toEqual({ error: 'invalid_request', message, fields: { 'X-Sandbox-Id': [message] } })
  })

  it('must be a UUID', async () => {
    for (const value of ['abc', '1234', `${randomUUID()}x`]) {
      const res = await t.http.get(TASKS).set('X-Sandbox-Id', value).expect(400)
      expect(res.body.error).toBe('invalid_request')
      expect(res.body.message).toBe(
        'La cabecera X-Sandbox-Id debe ser un UUID, por ejemplo 0b6e7d2a-3f4c-4b8e-9a1d-5c2f8e7a6b10.',
      )
    }
  })

  it('is checked on every tasks route, before the body', async () => {
    await t.http.get(`${TASKS}/stats`).expect(400)
    await t.http.get(`${TASKS}/${randomUUID()}`).expect(400)
    const res = await t.http.post(TASKS).send({ title: 'x' }).expect(400)
    expect(Object.keys(res.body.fields)).toEqual(['X-Sandbox-Id'])
  })

  it('is not needed for the health check', async () => {
    await t.http.get('/api/v1/health').expect(200)
  })

  it('ignores letter case', async () => {
    const id = randomUUID()
    const created = await t.sandbox(id).post(TASKS, { title: 'Mayúsculas' }).expect(201)
    await t.sandbox(id.toUpperCase()).get(`${TASKS}/${created.body.id}`).expect(200)
  })
})

describe('isolation', () => {
  it('keeps each visitor on their own data', async () => {
    const alice = t.sandbox()
    const bob = t.sandbox()

    const task = (await alice.post(TASKS, { title: 'Solo de Alice' }).expect(201)).body
    await alice.patch(`${TASKS}/${(await alice.get(TASKS)).body.items[1].id}`, { status: 'done' }).expect(200)

    expect((await alice.get(TASKS)).body.items).toHaveLength(4)
    expect((await bob.get(TASKS)).body.items).toHaveLength(3)
    await bob.get(`${TASKS}/${task.id}`).expect(404)
    await bob.patch(`${TASKS}/${task.id}`, { title: 'Intento de Bob' }).expect(404)
    await bob.delete(`${TASKS}/${task.id}`).expect(404)
    await alice.get(`${TASKS}/${task.id}`).expect(200)

    expect((await alice.get(`${TASKS}/stats`)).body.byStatus.done).toBe(2)
    expect((await bob.get(`${TASKS}/stats`)).body.byStatus.done).toBe(1)
  })

  it('gives every sandbox its own copies of the sample tasks', async () => {
    const a = (await t.sandbox().get(TASKS)).body.items.map((task: { id: string }) => task.id)
    const b = (await t.sandbox().get(TASKS)).body.items.map((task: { id: string }) => task.id)
    expect(a).toHaveLength(3)
    expect(a.filter((id: string) => b.includes(id))).toEqual([])
  })
})

describe('limits', () => {
  it('allows at most 50 tasks per sandbox', async () => {
    const box = t.sandbox()
    for (let i = 1; i <= 47; i++) await box.post(TASKS, { title: `Tarea ${i}` }).expect(201)

    const full = await box.post(TASKS, { title: 'La 51' }).expect(409)
    expect(full.body).toEqual({
      error: 'sandbox_full',
      message: 'Tu sandbox ya tiene 50 tareas, el máximo permitido. Borra alguna para crear otra.',
    })
    expect((await box.get(`${TASKS}/stats`)).body.total).toBe(50)

    const [first] = (await box.get(TASKS)).body.items
    await box.delete(`${TASKS}/${first.id}`).expect(204)
    await box.post(TASKS, { title: 'Ahora sí cabe' }).expect(201)
    await t.sandbox().post(TASKS, { title: 'Otro sandbox no se afecta' }).expect(201)
  })

  it('expires a sandbox after 30 minutes without use and starts it over', async () => {
    const box = t.sandbox()
    const task = (await box.post(TASKS, { title: 'Temporal' }).expect(201)).body

    // Each use renews the 30 minutes.
    t.clock.advance(29 * MINUTE)
    await box.get(`${TASKS}/${task.id}`).expect(200)
    t.clock.advance(29 * MINUTE)
    await box.get(`${TASKS}/${task.id}`).expect(200)

    t.clock.advance(30 * MINUTE)
    await box.get(`${TASKS}/${task.id}`).expect(404)
    const fresh = (await box.get(TASKS)).body.items
    expect(fresh).toHaveLength(3)
    expect(fresh.map((item: { title: string }) => item.title)).not.toContain('Temporal')
  })
})

describe('max sandboxes', () => {
  it('drops the least recently used sandbox past the cap', async () => {
    await t.app.close()
    t = await createTestApp({}, { sandbox: { ttlMs: 30 * MINUTE, maxSandboxes: 2, maxTasksPerSandbox: 50 } })
    const [a, b, c] = [t.sandbox(), t.sandbox(), t.sandbox()]

    const taskA = (await a.post(TASKS, { title: 'De A' })).body
    const taskB = (await b.post(TASKS, { title: 'De B' })).body
    await a.get(TASKS) // A is now more recent than B.
    await c.get(TASKS) // Third sandbox: B is dropped.

    await a.get(`${TASKS}/${taskA.id}`).expect(200)
    await b.get(`${TASKS}/${taskB.id}`).expect(404)
  })
})
