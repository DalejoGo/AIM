import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Task } from '../src/tasks/task.schemas.js'
import { createTestApp, MINUTE, type SandboxClient, TASKS, type TestApp } from './helpers.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MISSING_ID = '00000000-0000-4000-8000-000000000000'

let t: TestApp
let box: SandboxClient

beforeEach(async () => {
  t = await createTestApp()
  box = t.sandbox()
})

afterEach(async () => {
  await t.app.close()
})

/** Creates tasks one second apart, so their order by createdAt is known. */
async function createMany(titles: string[], extra: object = {}): Promise<Task[]> {
  const created: Task[] = []
  for (const title of titles) {
    t.clock.advance(1000)
    const res = await box.post(TASKS, { title, ...extra }).expect(201)
    created.push(res.body)
  }
  return created
}

const titles = (body: { items: Task[] }) => body.items.map((task) => task.title)

describe('CRUD', () => {
  it('creates a task with defaults, a Location header and server-side fields', async () => {
    const res = await box
      .post(TASKS, { title: '  Revisar el contrato  ', dueDate: '2026-12-01T10:00:00-05:00' })
      .expect(201)

    expect(res.body).toEqual({
      id: expect.stringMatching(UUID),
      title: 'Revisar el contrato',
      description: null,
      status: 'pending',
      priority: 'medium',
      dueDate: '2026-12-01T15:00:00.000Z',
      createdAt: '2026-11-06T12:00:00.000Z',
      updatedAt: '2026-11-06T12:00:00.000Z',
    })
    expect(res.headers.location).toBe(`${TASKS}/${res.body.id}`)
  })

  it('reads, partially updates and deletes a task', async () => {
    const created = (
      await box.post(TASKS, { title: 'Escribir pruebas', description: 'E2E con supertest', priority: 'high' })
    ).body as Task

    const read = await box.get(`${TASKS}/${created.id}`).expect(200)
    expect(read.body).toEqual(created)

    t.clock.advance(5 * MINUTE)
    const patched = await box.patch(`${TASKS}/${created.id}`, { status: 'in_progress' }).expect(200)
    expect(patched.body).toEqual({ ...created, status: 'in_progress', updatedAt: '2026-11-06T12:05:00.000Z' })

    const cleared = await box
      .patch(`${TASKS}/${created.id}`, { description: null, dueDate: null, title: 'Escribir más pruebas' })
      .expect(200)
    expect(cleared.body).toMatchObject({ title: 'Escribir más pruebas', description: null, dueDate: null })
    expect(cleared.body.priority).toBe('high')

    const deleted = await box.delete(`${TASKS}/${created.id}`).expect(204)
    expect(deleted.text).toBe('')
    await box.get(`${TASKS}/${created.id}`).expect(404)
    await box.delete(`${TASKS}/${created.id}`).expect(404)
  })

  it('answers 404 with an ApiError for a task that does not exist', async () => {
    for (const res of [
      await box.get(`${TASKS}/${MISSING_ID}`),
      await box.patch(`${TASKS}/${MISSING_ID}`, { status: 'done' }),
      await box.delete(`${TASKS}/${MISSING_ID}`),
    ]) {
      expect(res.status).toBe(404)
      expect(res.body).toEqual({
        error: 'not_found',
        message: `No encontramos la tarea ${MISSING_ID} en tu sandbox.`,
      })
    }
  })

  it('answers 404 with an ApiError for an unknown route', async () => {
    const res = await t.http.get('/api/v1/nope?secret=1').expect(404)
    expect(res.body).toEqual({ error: 'not_found', message: 'No existe la ruta GET /api/v1/nope.' })
  })
})

describe('list', () => {
  it('starts with the 3 sample tasks, newest first', async () => {
    const res = await box.get(TASKS).expect(200)
    expect(titles(res.body)).toEqual([
      'Configurar alertas de monitoreo',
      'Documentar la API con OpenAPI',
      'Diseñar el modelo de datos',
    ])
    expect(res.body.nextCursor).toBeNull()
  })

  it('filters by status and priority', async () => {
    await createMany(['Tarea alta pendiente'], { priority: 'high' })
    await createMany(['Tarea alta hecha'], { priority: 'high', status: 'done' })

    expect(titles((await box.get(`${TASKS}?status=done`)).body)).toEqual([
      'Tarea alta hecha',
      'Diseñar el modelo de datos',
    ])
    expect(titles((await box.get(`${TASKS}?priority=high&status=pending`)).body)).toEqual([
      'Tarea alta pendiente',
    ])
    expect(titles((await box.get(`${TASKS}?status=in_progress`)).body)).toEqual([
      'Documentar la API con OpenAPI',
    ])
  })

  it('searches title and description ignoring case and accents', async () => {
    await createMany(['Revisión de código'])
    await box.post(TASKS, { title: 'Otra tarea', description: 'Incluye la REVISION final' }).expect(201)

    expect(titles((await box.get(`${TASKS}?q=revision`)).body).sort()).toEqual([
      'Otra tarea',
      'Revisión de código',
    ])
    expect(titles((await box.get(`${TASKS}?q=${encodeURIComponent('MONITOREO')}`)).body)).toEqual([
      'Configurar alertas de monitoreo',
    ])
    expect((await box.get(`${TASKS}?q=nada-coincide`)).body.items).toEqual([])
  })

  it('sorts by createdAt and by dueDate, with tasks without dueDate last', async () => {
    expect(titles((await box.get(`${TASKS}?sort=createdAt:asc`)).body)).toEqual([
      'Diseñar el modelo de datos',
      'Documentar la API con OpenAPI',
      'Configurar alertas de monitoreo',
    ])
    // Sample due dates: "Diseñar" 2 days ago, "Configurar" 1 hour ago, "Documentar" none.
    expect(titles((await box.get(`${TASKS}?sort=dueDate:asc`)).body)).toEqual([
      'Diseñar el modelo de datos',
      'Configurar alertas de monitoreo',
      'Documentar la API con OpenAPI',
    ])
    expect(titles((await box.get(`${TASKS}?sort=dueDate:desc`)).body)).toEqual([
      'Configurar alertas de monitoreo',
      'Diseñar el modelo de datos',
      'Documentar la API con OpenAPI',
    ])
  })

  it('paginates with a cursor without skipping or repeating tasks', async () => {
    await createMany(['Tarea 1', 'Tarea 2', 'Tarea 3', 'Tarea 4', 'Tarea 5', 'Tarea 6', 'Tarea 7'])
    const all = titles((await box.get(`${TASKS}?limit=50`)).body)
    expect(all).toHaveLength(10)

    const seen: string[] = []
    const pageSizes: number[] = []
    let cursor: string | null = null
    do {
      const query: string = cursor ? `&cursor=${cursor}` : ''
      const res = await box.get(`${TASKS}?limit=4${query}`).expect(200)
      seen.push(...titles(res.body))
      pageSizes.push(res.body.items.length)
      cursor = res.body.nextCursor
    } while (cursor)

    expect(pageSizes).toEqual([4, 4, 2])
    expect(seen).toEqual(all)
  })

  it('keeps the next page right when a task of the current page is deleted', async () => {
    await createMany(['Tarea 1', 'Tarea 2', 'Tarea 3', 'Tarea 4', 'Tarea 5'])
    const first = (await box.get(`${TASKS}?sort=createdAt:asc&limit=3`)).body
    await box.delete(`${TASKS}/${first.items[0].id}`).expect(204)

    const second = (await box.get(`${TASKS}?sort=createdAt:asc&limit=3&cursor=${first.nextCursor}`)).body
    expect(titles(second)).toEqual(['Tarea 1', 'Tarea 2', 'Tarea 3'])
  })

  it('defaults to 10 per page', async () => {
    await createMany(Array.from({ length: 12 }, (_, i) => `Tarea ${i + 1}`))
    const res = await box.get(TASKS).expect(200)
    expect(res.body.items).toHaveLength(10)
    expect(res.body.nextCursor).toEqual(expect.any(String))
  })

  it('rejects a cursor made for another sort or that is not a cursor', async () => {
    await createMany(['Tarea 1', 'Tarea 2'])
    const { nextCursor } = (await box.get(`${TASKS}?limit=2`)).body

    for (const query of [`sort=dueDate:asc&cursor=${nextCursor}`, 'cursor=no-es-un-cursor']) {
      const res = await box.get(`${TASKS}?${query}`).expect(400)
      expect(res.body.error).toBe('invalid_request')
      expect(res.body.fields.cursor).toEqual([
        'El cursor no es válido para este orden. Pide de nuevo la primera página, sin cursor.',
      ])
    }
  })

  it('validates the query string', async () => {
    const res = await box.get(`${TASKS}?limit=51&status=closed&sort=title&priority=urgent`).expect(400)
    expect(res.body).toEqual({
      error: 'invalid_request',
      message: 'Hay datos que no son válidos. Revisa los campos marcados.',
      fields: {
        status: ['El estado debe ser pending, in_progress o done.'],
        priority: ['La prioridad debe ser low, medium o high.'],
        sort: ['El orden debe ser createdAt:desc, createdAt:asc, dueDate:asc o dueDate:desc.'],
        limit: ['limit debe ser un número entero entre 1 y 50.'],
      },
    })
    await box.get(`${TASKS}?limit=0`).expect(400)
    await box.get(`${TASKS}?limit=abc`).expect(400)
  })
})

describe('stats', () => {
  it('counts by status and priority, and overdue tasks by the clock', async () => {
    const initial = await box.get(`${TASKS}/stats`).expect(200)
    expect(initial.body).toEqual({
      total: 3,
      byStatus: { pending: 1, in_progress: 1, done: 1 },
      byPriority: { low: 1, medium: 1, high: 1 },
      overdue: 1,
    })

    await box.post(TASKS, { title: 'Vence en 20 minutos', priority: 'high', dueDate: '2026-11-06T12:20:00Z' })
    await box.post(TASKS, { title: 'Ya está hecha', status: 'done', dueDate: '2026-11-06T12:20:00Z' })
    expect((await box.get(`${TASKS}/stats`)).body.overdue).toBe(1)

    // Still inside the sandbox's 30 minutes, past the new due dates.
    t.clock.advance(25 * MINUTE)
    const later = (await box.get(`${TASKS}/stats`)).body
    expect(later).toMatchObject({ total: 5, overdue: 2, byPriority: { high: 2, medium: 2, low: 1 } })
  })
})

describe('validation', () => {
  it('reports every invalid field in Spanish', async () => {
    const res = await box
      .post(TASKS, {
        title: 'ab',
        description: 'x'.repeat(1001),
        dueDate: 'mañana',
        priority: 'urgent',
        color: 'red',
      })
      .expect(400)
    expect(res.body).toEqual({
      error: 'invalid_request',
      message: 'Hay datos que no son válidos. Revisa los campos marcados.',
      fields: {
        title: ['El título debe tener al menos 3 caracteres.'],
        description: ['La descripción puede tener máximo 1000 caracteres.'],
        priority: ['La prioridad debe ser low, medium o high.'],
        dueDate: [
          'La fecha límite debe estar en formato ISO 8601 con hora, por ejemplo 2026-12-01T17:00:00Z.',
        ],
        body: ['Campos no permitidos: color.'],
      },
    })
  })

  it('requires a title of 3 to 120 characters, not counting outer spaces', async () => {
    expect((await box.post(TASKS, {}).expect(400)).body.fields).toEqual({
      title: ['El título es obligatorio.'],
    })
    expect((await box.post(TASKS, { title: 42 }).expect(400)).body.fields).toEqual({
      title: ['El título debe ser texto.'],
    })
    expect((await box.post(TASKS, { title: '   ab   ' }).expect(400)).body.fields.title).toEqual([
      'El título debe tener al menos 3 caracteres.',
    ])
    expect((await box.post(TASKS, { title: 'x'.repeat(121) }).expect(400)).body.fields.title).toEqual([
      'El título puede tener máximo 120 caracteres.',
    ])
    await box.post(TASKS, { title: 'x'.repeat(120), description: 'y'.repeat(1000) }).expect(201)
  })

  it('rejects a body that is not a JSON object', async () => {
    const notObject = await box.post(TASKS, [1, 2]).expect(400)
    expect(notObject.body.fields).toEqual({ body: ['El cuerpo debe ser un objeto JSON.'] })

    const broken = await box
      .post(TASKS)
      .set('Content-Type', 'application/json')
      .send('{"title": ')
      .expect(400)
    expect(broken.body).toEqual({
      error: 'invalid_request',
      message: 'El cuerpo de la petición no es un JSON válido.',
    })
  })

  it('rejects an empty PATCH and an invalid id', async () => {
    const [created] = await createMany(['Para editar'])
    const empty = await box.patch(`${TASKS}/${created?.id}`, {}).expect(400)
    expect(empty.body.fields).toEqual({ body: ['Envía al menos un campo para actualizar.'] })

    const badId = await box.get(`${TASKS}/123`).expect(400)
    expect(badId.body.fields).toEqual({ id: ['El id de la tarea debe ser un UUID.'] })
  })

  it('answers 413 with an ApiError for a body over 16 kB', async () => {
    const res = await box.post(TASKS, { title: 'Grande', description: 'x'.repeat(20_000) }).expect(413)
    expect(res.body).toEqual({
      error: 'payload_too_large',
      message: 'El cuerpo de la petición es demasiado grande.',
    })
  })

  it('ignores prototype pollution keys', async () => {
    const res = await box
      .post(TASKS)
      .set('Content-Type', 'application/json')
      .send('{"title":"Normal","__proto__":{"polluted":true}}')
      .expect(201)
    expect(res.body.title).toBe('Normal')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
