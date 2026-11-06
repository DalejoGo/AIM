import type { Task, TaskSort } from './task.schemas.js'

/** What a position in a sorted list depends on; also what a cursor stores. */
export type TaskSortKey = Pick<Task, 'id' | 'createdAt' | 'dueDate'>

/**
 * Total order for each `sort`, so keyset pagination never skips or repeats a task: ties on `dueDate` fall back
 * to `createdAt`, and ties on `createdAt` to `id`. Tasks without `dueDate` go last in both directions (like
 * `NULLS LAST` in SQL). Dates are ISO strings in UTC, so comparing the strings compares the instants.
 */
export function compareTasks(sort: TaskSort): (a: TaskSortKey, b: TaskSortKey) => number {
  const [field, direction] = sort.split(':')
  const sign = direction === 'asc' ? 1 : -1

  return (a, b) => {
    if (field === 'dueDate' && a.dueDate !== b.dueDate) {
      if (a.dueDate === null) return 1
      if (b.dueDate === null) return -1
      return sign * compareStrings(a.dueDate, b.dueDate)
    }
    return sign * (compareStrings(a.createdAt, b.createdAt) || compareStrings(a.id, b.id))
  }
}

function compareStrings(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}
