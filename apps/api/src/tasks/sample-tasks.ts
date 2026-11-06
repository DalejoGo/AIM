import { randomUUID } from 'node:crypto'
import type { Task } from './task.schemas.js'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

/** The three tasks every new sandbox starts with: one per status, and one of them overdue. */
export function sampleTasks(now: number): Task[] {
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString()
  return [
    {
      id: randomUUID(),
      title: 'Diseñar el modelo de datos',
      description: 'Entidades, relaciones e índices para el módulo de tareas.',
      status: 'done',
      priority: 'high',
      dueDate: iso(-2 * DAY),
      createdAt: iso(-3 * DAY),
      updatedAt: iso(-2 * DAY),
    },
    {
      id: randomUUID(),
      title: 'Documentar la API con OpenAPI',
      description: 'Esquemas, ejemplos y errores de cada endpoint en /docs.',
      status: 'in_progress',
      priority: 'medium',
      dueDate: null,
      createdAt: iso(-2 * DAY),
      updatedAt: iso(-1 * DAY),
    },
    {
      id: randomUUID(),
      title: 'Configurar alertas de monitoreo',
      description: null,
      status: 'pending',
      priority: 'low',
      dueDate: iso(-1 * HOUR),
      createdAt: iso(-1 * DAY),
      updatedAt: iso(-1 * DAY),
    },
  ]
}
