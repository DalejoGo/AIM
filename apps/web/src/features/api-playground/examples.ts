import { TASKS_PATH } from './config'
import { ID_PLACEHOLDER, type Method, type RequestDraft, taskPath } from './request'

/** The requests the console starts from. Each one fills method, path and body; all stay editable. */

export type ExampleId = 'list' | 'get' | 'create' | 'update' | 'delete' | 'stats' | 'invalid'

export interface Example {
  id: ExampleId
  label: string
  method: Method
  /** What it shows, in one sentence. */
  description: string
  /** Endpoints with :id: the console offers the ids of the tasks it has seen. */
  needsTask: boolean
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'list',
    label: 'Listar tareas',
    method: 'GET',
    description: 'Filtra por estado y prioridad, busca texto, ordena y pagina con cursor.',
    needsTask: false,
  },
  {
    id: 'get',
    label: 'Ver una tarea',
    method: 'GET',
    description: 'Trae una tarea por su id.',
    needsTask: true,
  },
  {
    id: 'create',
    label: 'Crear una tarea',
    method: 'POST',
    description: 'Responde 201 con la tarea creada y su dirección en la cabecera Location.',
    needsTask: false,
  },
  {
    id: 'update',
    label: 'Editar una tarea',
    method: 'PATCH',
    description: 'Cambia solo los campos que envías.',
    needsTask: true,
  },
  {
    id: 'delete',
    label: 'Borrar una tarea',
    method: 'DELETE',
    description: 'Responde 204, sin cuerpo.',
    needsTask: true,
  },
  {
    id: 'stats',
    label: 'Estadísticas',
    method: 'GET',
    description: 'Cuenta las tareas por estado y prioridad, y las vencidas.',
    needsTask: false,
  },
  {
    id: 'invalid',
    label: 'Error de validación',
    method: 'POST',
    description: 'Un cuerpo con datos que no cumplen las reglas: mira cómo responde la API campo por campo.',
    needsTask: false,
  },
]

export const DEFAULT_EXAMPLE: ExampleId = 'list'

export function findExample(id: string): Example | undefined {
  return EXAMPLES.find((example) => example.id === id)
}

const DAY = 24 * 60 * 60_000

/** A week from `now` at 17:00 UTC, written the way the API docs do (no milliseconds). */
export function exampleDueDate(now: number): string {
  const date = new Date(now + 7 * DAY)
  date.setUTCHours(17, 0, 0, 0)
  return date.toISOString().replace('.000Z', 'Z')
}

const json = (value: unknown) => JSON.stringify(value, null, 2)

/** The draft an example fills in. `taskId` replaces {id} when the visitor already knows a task. */
export function exampleDraft(id: ExampleId, { now, taskId }: { now: number; taskId?: string }): RequestDraft {
  const withId = taskPath(taskId ?? ID_PLACEHOLDER)
  switch (id) {
    case 'list':
      return { method: 'GET', path: `${TASKS_PATH}?sort=createdAt:desc&limit=10`, body: '' }
    case 'get':
      return { method: 'GET', path: withId, body: '' }
    case 'create':
      return {
        method: 'POST',
        path: TASKS_PATH,
        body: json({
          title: 'Preparar la demo para el cliente',
          description: 'Probar el flujo completo antes de la reunión.',
          priority: 'high',
          dueDate: exampleDueDate(now),
        }),
      }
    case 'update':
      return { method: 'PATCH', path: withId, body: json({ status: 'done' }) }
    case 'delete':
      return { method: 'DELETE', path: withId, body: '' }
    case 'stats':
      return { method: 'GET', path: `${TASKS_PATH}/stats`, body: '' }
    case 'invalid':
      return {
        method: 'POST',
        path: TASKS_PATH,
        body: json({ title: 'ab', priority: 'urgente', dueDate: 'el viernes' }),
      }
  }
}

/** Options of the list filters. Values are what the API takes; labels are for people. */
export const STATUS_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'in_progress', label: 'En curso' },
  { value: 'done', label: 'Hecha' },
] as const

export const PRIORITY_OPTIONS = [
  { value: '', label: 'Todas' },
  { value: 'low', label: 'Baja' },
  { value: 'medium', label: 'Media' },
  { value: 'high', label: 'Alta' },
] as const

export const SORT_OPTIONS = [
  { value: 'createdAt:desc', label: 'Más recientes primero' },
  { value: 'createdAt:asc', label: 'Más antiguas primero' },
  { value: 'dueDate:asc', label: 'Fecha límite más cercana' },
  { value: 'dueDate:desc', label: 'Fecha límite más lejana' },
] as const

/** The API's default and maximum page size (apps/api/src/tasks/task.schemas.ts). */
export const DEFAULT_LIMIT = 10
export const MAX_LIMIT = 50
