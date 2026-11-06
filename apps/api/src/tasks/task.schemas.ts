import { z } from 'zod'

export const TASK_STATUSES = ['pending', 'in_progress', 'done'] as const
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const
/** `field:direction`. Tasks without `dueDate` always go last when sorting by it. */
export const TASK_SORTS = ['createdAt:desc', 'createdAt:asc', 'dueDate:asc', 'dueDate:desc'] as const
export const MAX_PAGE_SIZE = 50

export const TaskStatus = z.enum(TASK_STATUSES, { error: 'El estado debe ser pending, in_progress o done.' })
export type TaskStatus = z.infer<typeof TaskStatus>

export const TaskPriority = z.enum(TASK_PRIORITIES, { error: 'La prioridad debe ser low, medium o high.' })
export type TaskPriority = z.infer<typeof TaskPriority>

export const TaskSort = z.enum(TASK_SORTS, {
  error: 'El orden debe ser createdAt:desc, createdAt:asc, dueDate:asc o dueDate:desc.',
})
export type TaskSort = z.infer<typeof TaskSort>

export const TaskId = z.uuid({ error: 'El id de la tarea debe ser un UUID.' })

const Title = z
  .string({
    error: (issue) => (issue.input === undefined ? 'El título es obligatorio.' : 'El título debe ser texto.'),
  })
  .trim()
  .min(3, 'El título debe tener al menos 3 caracteres.')
  .max(120, 'El título puede tener máximo 120 caracteres.')
  .meta({ description: 'Entre 3 y 120 caracteres; se quitan los espacios de los extremos.' })

const Description = z
  .string({ error: 'La descripción debe ser texto.' })
  .trim()
  .max(1000, 'La descripción puede tener máximo 1000 caracteres.')
  .meta({ description: 'Hasta 1000 caracteres.' })

const DueDateInput = z.iso
  .datetime({
    offset: true,
    error: 'La fecha límite debe estar en formato ISO 8601 con hora, por ejemplo 2026-12-01T17:00:00Z.',
  })
  .transform((value) => new Date(value).toISOString())
  .meta({ description: 'Fecha y hora ISO 8601 (con Z o con zona horaria). Se guarda en UTC.' })

/** Errors of the object itself: a body that is not an object, or keys the schema does not know. */
const bodyError = (issue: { code?: string; keys?: string[] }) => {
  if (issue.code === 'unrecognized_keys') return `Campos no permitidos: ${issue.keys?.join(', ')}.`
  if (issue.code === 'invalid_type') return 'El cuerpo debe ser un objeto JSON.'
  return undefined
}

export const CreateTaskSchema = z
  .strictObject(
    {
      title: Title,
      description: Description.optional(),
      status: TaskStatus.default('pending'),
      priority: TaskPriority.default('medium'),
      dueDate: DueDateInput.optional(),
    },
    { error: bodyError },
  )
  .meta({
    id: 'CreateTask',
    // `example`, not `examples`: Zod drops `examples` from the input schema of anything with a transform.
    example: {
      title: 'Preparar la demo para el cliente',
      description: 'Probar el flujo completo antes de la reunión.',
      priority: 'high',
      dueDate: '2026-12-01T17:00:00Z',
    },
  })
export type CreateTask = z.infer<typeof CreateTaskSchema>

export const UpdateTaskSchema = z
  .strictObject(
    {
      title: Title.optional(),
      description: Description.nullable().optional(),
      status: TaskStatus.optional(),
      priority: TaskPriority.optional(),
      dueDate: DueDateInput.nullable().optional(),
    },
    { error: bodyError },
  )
  .refine((patch) => Object.keys(patch).length > 0, 'Envía al menos un campo para actualizar.')
  .meta({
    id: 'UpdateTask',
    description: 'Solo los campos que cambian. `null` borra la descripción o la fecha límite.',
    example: { status: 'done' },
  })
export type UpdateTask = z.infer<typeof UpdateTaskSchema>

const LIMIT_MESSAGE = `limit debe ser un número entero entre 1 y ${MAX_PAGE_SIZE}.`

export const ListTasksQuerySchema = z.object({
  status: TaskStatus.optional().meta({ description: 'Solo las tareas en este estado.' }),
  priority: TaskPriority.optional().meta({ description: 'Solo las tareas con esta prioridad.' }),
  q: z
    .string({ error: 'q debe ser texto.' })
    .trim()
    .max(100, 'q puede tener máximo 100 caracteres.')
    .optional()
    .meta({ description: 'Busca en el título y la descripción, sin distinguir mayúsculas ni tildes.' }),
  sort: TaskSort.default('createdAt:desc').meta({ description: 'Campo y sentido del orden.' }),
  limit: z.coerce
    .number({ error: LIMIT_MESSAGE })
    .int(LIMIT_MESSAGE)
    .min(1, LIMIT_MESSAGE)
    .max(MAX_PAGE_SIZE, LIMIT_MESSAGE)
    .default(10)
    .meta({ description: `Tareas por página (1 a ${MAX_PAGE_SIZE}).` }),
  cursor: z
    .string({ error: 'cursor debe ser texto.' })
    .max(512, 'El cursor no es válido.')
    .optional()
    .meta({ description: 'El `nextCursor` de la página anterior; con el mismo `sort`.' }),
})
export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>

const ISO_EXAMPLE = '2026-11-06T15:30:00.000Z'

export const TaskSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    description: z.string().nullable(),
    status: TaskStatus,
    priority: TaskPriority,
    dueDate: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({
    id: 'Task',
    examples: [
      {
        id: '5d0f8a5e-8a39-4c55-9a43-0f5b8c1d2e3f',
        title: 'Documentar la API con OpenAPI',
        description: 'Esquemas, ejemplos y errores de cada endpoint.',
        status: 'in_progress',
        priority: 'medium',
        dueDate: '2026-11-20T17:00:00.000Z',
        createdAt: ISO_EXAMPLE,
        updatedAt: ISO_EXAMPLE,
      },
    ],
  })
export type Task = z.infer<typeof TaskSchema>

export const TaskPageSchema = z
  .object({
    items: z.array(TaskSchema),
    nextCursor: z
      .string()
      .nullable()
      .meta({ description: 'Pásalo como `cursor` para la página siguiente; `null` si no hay más.' }),
  })
  .meta({ id: 'TaskPage' })
export type TaskPage = z.infer<typeof TaskPageSchema>

const count = z.number().int().nonnegative()

export const TaskStatsSchema = z
  .object({
    total: count,
    byStatus: z.object({ pending: count, in_progress: count, done: count }),
    byPriority: z.object({ low: count, medium: count, high: count }),
    overdue: count.meta({ description: 'Sin terminar y con la fecha límite ya pasada.' }),
  })
  .meta({
    id: 'TaskStats',
    examples: [
      {
        total: 3,
        byStatus: { pending: 1, in_progress: 1, done: 1 },
        byPriority: { low: 1, medium: 1, high: 1 },
        overdue: 1,
      },
    ],
  })
export type TaskStats = z.infer<typeof TaskStatsSchema>
