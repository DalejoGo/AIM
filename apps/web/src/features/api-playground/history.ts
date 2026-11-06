import type { Outcome } from './client'
import { isListPath, isMethod, type Method, taskIdOf } from './request'
import type { Body, HeaderLine } from './response'

/**
 * The session's last requests, newest first, kept in sessionStorage so a reload does not lose them. The tasks
 * the console has seen (to offer their ids) are worked out from the same answers.
 */

export const HISTORY_KEY = 'aim-playground-history'
export const HISTORY_SIZE = 10

export interface SentRequest {
  method: Method
  path: string
  /** Compact JSON, or `null` when no body went. */
  body: string | null
}

export interface Exchange {
  id: string
  /** When it was sent (epoch ms). */
  at: number
  request: SentRequest
  outcome: Outcome
  /** The API may have been asleep and the request took long: its time includes the start-up. */
  slowStart: boolean
}

/** Adds the newest exchange on top and keeps the last `max`. */
export function addExchange(list: readonly Exchange[], exchange: Exchange, max = HISTORY_SIZE): Exchange[] {
  return [exchange, ...list.filter((item) => item.id !== exchange.id)].slice(0, max)
}

/** When the API last answered (epoch ms), to tell whether it may have gone back to sleep. */
export function lastAnswerAt(list: readonly Exchange[]): number | null {
  const answered = list.find((item) => item.outcome.kind === 'response')
  return answered ? answered.at + answered.outcome.totalMs : null
}

// --- Storage ------------------------------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

function isHeaderLine(value: unknown): value is HeaderLine {
  return isRecord(value) && typeof value.name === 'string' && typeof value.value === 'string'
}

function isOutcome(value: unknown): value is Outcome {
  if (!isRecord(value) || !isTime(value.totalMs)) return false
  if (value.kind === 'timeout' || value.kind === 'network') return true
  return (
    value.kind === 'response' &&
    typeof value.status === 'number' &&
    Number.isInteger(value.status) &&
    value.status >= 100 &&
    value.status <= 599 &&
    typeof value.body === 'string' &&
    Array.isArray(value.headers) &&
    value.headers.every(isHeaderLine)
  )
}

function isExchange(value: unknown): value is Exchange {
  if (!isRecord(value) || typeof value.id !== 'string' || !isTime(value.at)) return false
  const request = value.request
  return (
    isRecord(request) &&
    isMethod(request.method) &&
    typeof request.path === 'string' &&
    (request.body === null || typeof request.body === 'string') &&
    typeof value.slowStart === 'boolean' &&
    isOutcome(value.outcome)
  )
}

/** The stored history; anything unreadable or malformed is dropped instead of breaking the page. */
export function parseHistory(raw: string | null): Exchange[] {
  if (!raw) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  return Array.isArray(data) ? data.filter(isExchange).slice(0, HISTORY_SIZE) : []
}

// --- Tasks seen in the answers ---------------------------------------------------------------------------------

export interface KnownTask {
  id: string
  title: string
}

export const MAX_KNOWN_TASKS = 50

function asTask(value: unknown): KnownTask | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id === '') return null
  return { id: value.id, title: typeof value.title === 'string' ? value.title : '' }
}

function upsert(known: readonly KnownTask[], task: KnownTask, at: 'start' | 'end'): KnownTask[] {
  const index = known.findIndex((item) => item.id === task.id)
  if (index !== -1) return known.map((item, i) => (i === index ? task : item))
  return (at === 'start' ? [task, ...known] : [...known, task]).slice(0, MAX_KNOWN_TASKS)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * What an answer teaches about the sandbox's tasks: a list or a single task adds or renames them, a created
 * task goes first, and a 204 to DELETE or a 404 for an id removes it.
 */
export function learnTasks(known: readonly KnownTask[], exchange: Exchange): KnownTask[] {
  const { request, outcome } = exchange
  if (outcome.kind !== 'response') return [...known]
  const { status } = outcome
  const id = taskIdOf(request.path)

  if (id !== null && (status === 404 || (request.method === 'DELETE' && status === 204))) {
    return known.filter((item) => item.id !== id)
  }
  if (status < 200 || status >= 300) return [...known]

  const body = parseJson(outcome.body)
  if (isListPath(request.path) && request.method === 'GET' && isRecord(body) && Array.isArray(body.items)) {
    return body.items.reduce<KnownTask[]>(
      (list, item) => {
        const task = asTask(item)
        return task ? upsert(list, task, 'end') : list
      },
      [...known],
    )
  }
  const task = asTask(body)
  if (!task) return [...known]
  if (isListPath(request.path) && request.method === 'POST') return upsert(known, task, 'start')
  if (id !== null && (request.method === 'GET' || request.method === 'PATCH'))
    return upsert(known, task, 'end')
  return [...known]
}

/** The tasks seen in a stored history (newest first), replayed from the oldest. */
export function knownTasksFrom(list: readonly Exchange[]): KnownTask[] {
  return list.reduceRight<KnownTask[]>((known, exchange) => learnTasks(known, exchange), [])
}

/** `nextCursor` of a list page, when there is a next page. */
export function nextCursorOf(body: Body): string | null {
  if (body.kind !== 'json' || !isRecord(body.value)) return null
  const cursor = body.value.nextCursor
  return typeof cursor === 'string' && cursor !== '' ? cursor : null
}
