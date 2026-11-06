import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '../common/clock.js'
import { SANDBOX_LIMITS, type SandboxLimits } from '../config.js'
import { SandboxStore } from '../sandbox/sandbox-store.js'
import { sampleTasks } from './sample-tasks.js'
import type { Task, TaskStats } from './task.schemas.js'
import { compareTasks } from './task-order.js'
import type { TaskListFilter, TasksRepository } from './tasks.repository.js'

/**
 * Tasks kept in memory, one Map per sandbox. A new or expired sandbox starts with the sample tasks.
 * Returns copies, as a database would, so callers cannot change stored tasks by accident.
 */
@Injectable()
export class InMemoryTasksRepository implements TasksRepository {
  private readonly sandboxes: SandboxStore<Map<string, Task>>

  constructor(@Inject(CLOCK) clock: Clock, @Inject(SANDBOX_LIMITS) limits: SandboxLimits) {
    this.sandboxes = new SandboxStore(
      { ttlMs: limits.ttlMs, maxSandboxes: limits.maxSandboxes },
      clock,
      (now) => new Map(sampleTasks(now).map((task) => [task.id, task])),
    )
  }

  async list(sandboxId: string, filter: TaskListFilter): Promise<{ items: Task[]; hasMore: boolean }> {
    const compare = compareTasks(filter.sort)
    const needle = filter.q ? fold(filter.q) : ''
    const matches = [...this.tasks(sandboxId).values()]
      .filter((task) => !filter.status || task.status === filter.status)
      .filter((task) => !filter.priority || task.priority === filter.priority)
      .filter((task) => !needle || fold(`${task.title}\n${task.description ?? ''}`).includes(needle))
      .filter((task) => !filter.after || compare(task, filter.after) > 0)
      .sort(compare)

    return {
      items: matches.slice(0, filter.limit).map((task) => ({ ...task })),
      hasMore: matches.length > filter.limit,
    }
  }

  async findById(sandboxId: string, id: string): Promise<Task | null> {
    const task = this.tasks(sandboxId).get(id)
    return task ? { ...task } : null
  }

  async count(sandboxId: string): Promise<number> {
    return this.tasks(sandboxId).size
  }

  async insert(sandboxId: string, task: Task): Promise<void> {
    this.tasks(sandboxId).set(task.id, { ...task })
  }

  async update(sandboxId: string, task: Task): Promise<void> {
    const tasks = this.tasks(sandboxId)
    if (tasks.has(task.id)) tasks.set(task.id, { ...task })
  }

  async delete(sandboxId: string, id: string): Promise<boolean> {
    return this.tasks(sandboxId).delete(id)
  }

  async stats(sandboxId: string, now: string): Promise<TaskStats> {
    const stats: TaskStats = {
      total: 0,
      byStatus: { pending: 0, in_progress: 0, done: 0 },
      byPriority: { low: 0, medium: 0, high: 0 },
      overdue: 0,
    }
    for (const task of this.tasks(sandboxId).values()) {
      stats.total++
      stats.byStatus[task.status]++
      stats.byPriority[task.priority]++
      if (task.status !== 'done' && task.dueDate !== null && task.dueDate < now) stats.overdue++
    }
    return stats
  }

  private tasks(sandboxId: string): Map<string, Task> {
    return this.sandboxes.get(sandboxId)
  }
}

/** Lowercase without accents, so "configuracion" finds "Configuración". */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}
