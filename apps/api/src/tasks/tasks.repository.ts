import type { Task, TaskPriority, TaskSort, TaskStats, TaskStatus } from './task.schemas.js'
import type { TaskSortKey } from './task-order.js'

export interface TaskListFilter {
  status?: TaskStatus
  priority?: TaskPriority
  /** Free text; already trimmed. Empty means no search. */
  q?: string
  sort: TaskSort
  limit: number
  /** Return only tasks after this key in `sort` order (keyset pagination). */
  after?: TaskSortKey
}

/**
 * Port for task storage. Every call is scoped to one sandbox, so visitors never see each other's data.
 * Today it is in memory (`InMemoryTasksRepository`); a Postgres adapter can replace it without touching the
 * service or the controller. Methods are async for that reason.
 */
export interface TasksRepository {
  list(sandboxId: string, filter: TaskListFilter): Promise<{ items: Task[]; hasMore: boolean }>
  findById(sandboxId: string, id: string): Promise<Task | null>
  count(sandboxId: string): Promise<number>
  insert(sandboxId: string, task: Task): Promise<void>
  /** Replaces the stored task with the same id. */
  update(sandboxId: string, task: Task): Promise<void>
  /** `false` when there was no such task. */
  delete(sandboxId: string, id: string): Promise<boolean>
  /** `now` (ISO) decides which tasks are overdue. */
  stats(sandboxId: string, now: string): Promise<TaskStats>
}

export const TASKS_REPOSITORY = Symbol('TasksRepository')
