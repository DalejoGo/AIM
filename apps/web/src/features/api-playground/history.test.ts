import { describe, expect, it } from 'vitest'
import type { Outcome } from './client'
import {
  addExchange,
  type Exchange,
  HISTORY_SIZE,
  type KnownTask,
  knownTasksFrom,
  lastAnswerAt,
  learnTasks,
  MAX_KNOWN_TASKS,
  nextCursorOf,
  parseHistory,
} from './history'
import type { Method } from './request'
import { readBody } from './response'

const A = { id: 'aaaaaaaa-0000-4000-8000-000000000001', title: 'Diseñar el modelo de datos' }
const B = { id: 'bbbbbbbb-0000-4000-8000-000000000002', title: 'Documentar la API' }
const C = { id: 'cccccccc-0000-4000-8000-000000000003', title: 'Configurar alertas' }

let counter = 0

function exchange(
  method: Method,
  path: string,
  outcome: Partial<Extract<Outcome, { kind: 'response' }>> | Outcome = {},
  at = 1000,
): Exchange {
  const full: Outcome =
    'kind' in outcome && outcome.kind !== 'response'
      ? (outcome as Outcome)
      : { kind: 'response', status: 200, headers: [], body: '', totalMs: 100, ...outcome }
  counter++
  return { id: `e${counter}`, at, request: { method, path, body: null }, outcome: full, slowStart: false }
}

const page = (...tasks: KnownTask[]) => JSON.stringify({ items: tasks, nextCursor: null })

describe('addExchange', () => {
  it('puts the newest first and keeps the last 10', () => {
    let list: Exchange[] = []
    for (let i = 0; i < 12; i++) list = addExchange(list, exchange('GET', `/api/v1/tasks?n=${i}`))
    expect(list).toHaveLength(HISTORY_SIZE)
    expect(list[0]?.request.path).toBe('/api/v1/tasks?n=11')
    expect(list.at(-1)?.request.path).toBe('/api/v1/tasks?n=2')
  })

  it('does not repeat an exchange already there', () => {
    const one = exchange('GET', '/x')
    expect(addExchange([one], one)).toEqual([one])
  })
})

describe('lastAnswerAt', () => {
  it('is when the newest answer arrived, skipping requests that got none', () => {
    const answered = exchange('GET', '/a', { totalMs: 250 }, 10_000)
    const timedOut = exchange('GET', '/b', { kind: 'timeout', totalMs: 75_000 }, 20_000)
    expect(lastAnswerAt([timedOut, answered])).toBe(10_250)
    expect(lastAnswerAt([timedOut])).toBeNull()
    expect(lastAnswerAt([])).toBeNull()
  })
})

describe('parseHistory', () => {
  it('reads back what was stored', () => {
    const list = [
      exchange('POST', '/api/v1/tasks', {
        status: 201,
        body: '{}',
        headers: [{ name: 'location', value: '/x' }],
      }),
      exchange('GET', '/api/v1/tasks', { kind: 'network', totalMs: 12 }),
    ]
    expect(parseHistory(JSON.stringify(list))).toEqual(list)
  })

  it('drops what it cannot trust instead of failing', () => {
    const good = exchange('GET', '/api/v1/tasks')
    const bad = [
      { ...good, id: 1 },
      { ...good, at: -1 },
      { ...good, request: { ...good.request, method: 'PUT' } },
      { ...good, request: { ...good.request, body: 1 } },
      { ...good, slowStart: 'no' },
      { ...good, outcome: { kind: 'response', status: 99, headers: [], body: '', totalMs: 1 } },
      { ...good, outcome: { kind: 'response', status: 200, headers: [{ name: 1 }], body: '', totalMs: 1 } },
      { ...good, outcome: { kind: 'response', status: 200, headers: [], body: null, totalMs: 1 } },
      { ...good, outcome: { kind: 'other', totalMs: 1 } },
      { ...good, outcome: { kind: 'timeout', totalMs: Number.NaN } },
      null,
      'x',
    ]
    expect(parseHistory(JSON.stringify([...bad, good]))).toEqual([good])
    expect(parseHistory(null)).toEqual([])
    expect(parseHistory('')).toEqual([])
    expect(parseHistory('{not json')).toEqual([])
    expect(parseHistory('{"a":1}')).toEqual([])
  })

  it('keeps at most 10', () => {
    const many = Array.from({ length: 15 }, (_, i) => exchange('GET', `/n/${i}`))
    expect(parseHistory(JSON.stringify(many))).toHaveLength(HISTORY_SIZE)
  })
})

describe('learnTasks', () => {
  it('learns the tasks of a list page, in order, and updates titles', () => {
    const known = learnTasks([], exchange('GET', '/api/v1/tasks?limit=10', { body: page(A, B) }))
    expect(known).toEqual([A, B])
    const renamed = { ...A, title: 'Nuevo título' }
    expect(
      learnTasks(known, exchange('GET', '/api/v1/tasks/?status=done', { body: page(renamed, C) })),
    ).toEqual([renamed, B, C])
  })

  it('puts a created task first', () => {
    const created = exchange('POST', '/api/v1/tasks', { status: 201, body: JSON.stringify(C) })
    expect(learnTasks([A, B], created)).toEqual([C, A, B])
  })

  it('learns a task read or edited by id', () => {
    expect(learnTasks([A], exchange('GET', `/api/v1/tasks/${B.id}`, { body: JSON.stringify(B) }))).toEqual([
      A,
      B,
    ])
    const edited = { ...A, title: 'Editada' }
    expect(
      learnTasks([A, B], exchange('PATCH', `/api/v1/tasks/${A.id}`, { body: JSON.stringify(edited) })),
    ).toEqual([edited, B])
  })

  it('forgets a deleted task and one the API no longer finds', () => {
    expect(learnTasks([A, B], exchange('DELETE', `/api/v1/tasks/${A.id}`, { status: 204 }))).toEqual([B])
    expect(learnTasks([A, B], exchange('GET', `/api/v1/tasks/${B.id}`, { status: 404, body: '{}' }))).toEqual(
      [A],
    )
  })

  it('ignores errors, failures, stats and bodies that are not tasks', () => {
    const known = [A]
    for (const item of [
      exchange('POST', '/api/v1/tasks', { status: 400, body: '{"error":"invalid_request","message":"x"}' }),
      exchange('GET', '/api/v1/tasks', { kind: 'timeout', totalMs: 75_000 }),
      exchange('GET', '/api/v1/tasks/stats', { body: '{"total":3}' }),
      exchange('GET', '/api/v1/tasks', { body: 'not json' }),
      exchange('GET', '/api/v1/tasks', { body: '{"items":[{"title":"sin id"},null,{"id":""}]}' }),
      exchange('DELETE', `/api/v1/tasks/${A.id}`, { status: 500 }),
      exchange('POST', `/api/v1/tasks/${A.id}`, { status: 200, body: JSON.stringify(B) }),
    ]) {
      expect(learnTasks(known, item)).toEqual(known)
    }
  })

  it('keeps a task without a title with an empty one', () => {
    expect(learnTasks([], exchange('GET', '/api/v1/tasks', { body: '{"items":[{"id":"x"}]}' }))).toEqual([
      { id: 'x', title: '' },
    ])
  })

  it(`remembers at most ${MAX_KNOWN_TASKS} tasks`, () => {
    const tasks = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, title: `Tarea ${i}` }))
    expect(learnTasks([], exchange('GET', '/api/v1/tasks', { body: page(...tasks) }))).toHaveLength(
      MAX_KNOWN_TASKS,
    )
  })
})

describe('knownTasksFrom', () => {
  it('replays a stored history from the oldest exchange', () => {
    const history = [
      exchange('DELETE', `/api/v1/tasks/${B.id}`, { status: 204 }),
      exchange('POST', '/api/v1/tasks', { status: 201, body: JSON.stringify(C) }),
      exchange('GET', '/api/v1/tasks', { body: page(A, B) }),
    ]
    expect(knownTasksFrom(history)).toEqual([C, A])
    expect(knownTasksFrom([])).toEqual([])
  })
})

describe('nextCursorOf', () => {
  it('reads the cursor of a page that has more', () => {
    expect(nextCursorOf(readBody('{"items":[],"nextCursor":"abc"}'))).toBe('abc')
    expect(nextCursorOf(readBody('{"items":[],"nextCursor":null}'))).toBeNull()
    expect(nextCursorOf(readBody('{"items":[],"nextCursor":""}'))).toBeNull()
    expect(nextCursorOf(readBody('[1]'))).toBeNull()
    expect(nextCursorOf(readBody(''))).toBeNull()
  })
})
