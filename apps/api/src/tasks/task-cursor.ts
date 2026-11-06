import { z } from 'zod'
import { TaskSort } from './task.schemas.js'
import type { TaskSortKey } from './task-order.js'

const CursorPayload = z.object({
  sort: TaskSort,
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  dueDate: z.iso.datetime().nullable(),
})

/**
 * Opaque keyset cursor: the sort key of the last task of a page, base64url-encoded. Unlike an offset, it stays
 * right when tasks are created or deleted between pages, and it maps to a `WHERE (...) > (...)` in SQL.
 */
export function encodeCursor(sort: TaskSort, last: TaskSortKey): string {
  const payload = { sort, id: last.id, createdAt: last.createdAt, dueDate: last.dueDate }
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

/** The key the next page starts after, or `null` when the cursor is malformed or was made for another sort. */
export function decodeCursor(cursor: string, sort: TaskSort): TaskSortKey | null {
  let json: unknown
  try {
    json = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const parsed = CursorPayload.safeParse(json)
  if (!parsed.success || parsed.data.sort !== sort) return null
  const { id, createdAt, dueDate } = parsed.data
  return { id, createdAt, dueDate }
}
