import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXAMPLE,
  EXAMPLES,
  exampleDraft,
  exampleDueDate,
  findExample,
  PRIORITY_OPTIONS,
  SORT_OPTIONS,
  STATUS_OPTIONS,
} from './examples'
import { checkBody, isListPath, pathProblem, readListFilters, sendsBody, taskIdOf } from './request'

const NOW = Date.parse('2026-11-06T15:30:00Z')
const TASK = '5d0f8a5e-8a39-4c55-9a43-0f5b8c1d2e3f'

describe('EXAMPLES', () => {
  it('cover every endpoint of the API plus a validation error, each once', () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual([
      'list',
      'get',
      'create',
      'update',
      'delete',
      'stats',
      'invalid',
    ])
    expect(findExample(DEFAULT_EXAMPLE)?.label).toBe('Listar tareas')
    expect(findExample('nope')).toBeUndefined()
  })

  it('match the method of the draft they fill, and the body rules of that method', () => {
    for (const example of EXAMPLES) {
      const draft = exampleDraft(example.id, { now: NOW, taskId: TASK })
      expect(draft.method, example.id).toBe(example.method)
      expect(pathProblem(draft.path), example.id).toBeNull()
      if (sendsBody(draft.method)) expect(checkBody(draft.body).ok, example.id).toBe(true)
      else expect(draft.body, example.id).toBe('')
    }
  })

  it('point the examples with :id at the picked task, or at the placeholder', () => {
    for (const example of EXAMPLES) {
      const withTask = exampleDraft(example.id, { now: NOW, taskId: TASK })
      const without = exampleDraft(example.id, { now: NOW })
      expect(taskIdOf(withTask.path) === TASK, example.id).toBe(example.needsTask)
      expect(pathProblem(without.path) !== null, example.id).toBe(example.needsTask)
    }
  })
})

describe('exampleDraft', () => {
  it('lists with an explicit sort and page size, so the filters show them', () => {
    const draft = exampleDraft('list', { now: NOW })
    expect(isListPath(draft.path)).toBe(true)
    expect(readListFilters(draft.path)).toMatchObject({ sort: 'createdAt:desc', limit: '10' })
  })

  it('creates a valid task due a week later', () => {
    const body = JSON.parse(exampleDraft('create', { now: NOW }).body)
    expect(body).toEqual({
      title: 'Preparar la demo para el cliente',
      description: 'Probar el flujo completo antes de la reunión.',
      priority: 'high',
      dueDate: '2026-11-13T17:00:00Z',
    })
  })

  it('breaks three rules at once in the validation example', () => {
    const body = JSON.parse(exampleDraft('invalid', { now: NOW }).body)
    expect(Object.keys(body)).toEqual(['title', 'priority', 'dueDate'])
    expect(body.title.length).toBeLessThan(3)
    expect(['low', 'medium', 'high']).not.toContain(body.priority)
    expect(Number.isNaN(Date.parse(body.dueDate))).toBe(true)
  })

  it('asks for stats on their own path, not as an id', () => {
    const draft = exampleDraft('stats', { now: NOW })
    expect(draft.path).toBe('/api/v1/tasks/stats')
    expect(taskIdOf(draft.path)).toBeNull()
  })
})

describe('exampleDueDate', () => {
  it('is 7 days later at 17:00 UTC without milliseconds', () => {
    expect(exampleDueDate(NOW)).toBe('2026-11-13T17:00:00Z')
    expect(exampleDueDate(Date.parse('2026-12-28T23:59:59.999Z'))).toBe('2027-01-04T17:00:00Z')
  })
})

describe('filter options', () => {
  it('use the values the API accepts', () => {
    expect(STATUS_OPTIONS.map((o) => o.value)).toEqual(['', 'pending', 'in_progress', 'done'])
    expect(PRIORITY_OPTIONS.map((o) => o.value)).toEqual(['', 'low', 'medium', 'high'])
    expect(SORT_OPTIONS.map((o) => o.value)).toEqual([
      'createdAt:desc',
      'createdAt:asc',
      'dueDate:asc',
      'dueDate:desc',
    ])
  })
})
