import { randomUUID } from 'node:crypto'
import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { ApiException, RequestValidationException } from '../common/api-error.js'
import { CLOCK, type Clock } from '../common/clock.js'
import { SANDBOX_LIMITS, type SandboxLimits } from '../config.js'
import type { CreateTask, ListTasksQuery, Task, TaskPage, TaskStats, UpdateTask } from './task.schemas.js'
import { decodeCursor, encodeCursor } from './task-cursor.js'
import { TASKS_REPOSITORY, type TasksRepository } from './tasks.repository.js'

/** Business rules of the Tareas API: ids and timestamps, the per-sandbox cap, cursors and 404s. */
@Injectable()
export class TasksService {
  constructor(
    @Inject(TASKS_REPOSITORY) private readonly repository: TasksRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SANDBOX_LIMITS) private readonly limits: SandboxLimits,
  ) {}

  async list(sandboxId: string, query: ListTasksQuery): Promise<TaskPage> {
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor, query.sort)
    if (after === null) {
      throw new RequestValidationException({
        cursor: ['El cursor no es válido para este orden. Pide de nuevo la primera página, sin cursor.'],
      })
    }
    const { items, hasMore } = await this.repository.list(sandboxId, {
      status: query.status,
      priority: query.priority,
      q: query.q,
      sort: query.sort,
      limit: query.limit,
      after,
    })
    const last = items.at(-1)
    return { items, nextCursor: hasMore && last ? encodeCursor(query.sort, last) : null }
  }

  async get(sandboxId: string, id: string): Promise<Task> {
    const task = await this.repository.findById(sandboxId, id)
    if (!task) throw notFound(id)
    return task
  }

  async create(sandboxId: string, input: CreateTask): Promise<Task> {
    const max = this.limits.maxTasksPerSandbox
    if ((await this.repository.count(sandboxId)) >= max) {
      throw new ApiException(HttpStatus.CONFLICT, {
        error: 'sandbox_full',
        message: `Tu sandbox ya tiene ${max} tareas, el máximo permitido. Borra alguna para crear otra.`,
      })
    }
    const now = this.nowIso()
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      description: input.description ?? null,
      status: input.status,
      priority: input.priority,
      dueDate: input.dueDate ?? null,
      createdAt: now,
      updatedAt: now,
    }
    await this.repository.insert(sandboxId, task)
    return task
  }

  async update(sandboxId: string, id: string, patch: UpdateTask): Promise<Task> {
    const current = await this.get(sandboxId, id)
    const next: Task = { ...current, ...patch, updatedAt: this.nowIso() }
    await this.repository.update(sandboxId, next)
    return next
  }

  async remove(sandboxId: string, id: string): Promise<void> {
    if (!(await this.repository.delete(sandboxId, id))) throw notFound(id)
  }

  stats(sandboxId: string): Promise<TaskStats> {
    return this.repository.stats(sandboxId, this.nowIso())
  }

  private nowIso(): string {
    return new Date(this.clock.now()).toISOString()
  }
}

function notFound(id: string): ApiException {
  return ApiException.notFound(`No encontramos la tarea ${id} en tu sandbox.`)
}
