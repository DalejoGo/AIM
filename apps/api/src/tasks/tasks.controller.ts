import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { ApiErrorResponses } from '../common/api-error.docs.js'
import { pathOf } from '../common/request-path.js'
import { ApiSandboxHeader, SandboxGuard, SandboxId } from '../sandbox/sandbox.guard.js'
import {
  type CreateTask,
  CreateTaskSchema,
  type ListTasksQuery,
  ListTasksQuerySchema,
  type Task,
  TaskId,
  type TaskPage,
  TaskPageSchema,
  TaskSchema,
  type TaskStats,
  TaskStatsSchema,
  type UpdateTask,
  UpdateTaskSchema,
} from './task.schemas.js'
import { TasksService } from './tasks.service.js'

const ID_PARAM = { name: 'id', description: 'UUID de la tarea.', format: 'uuid' } as const

@ApiTags('tasks')
@ApiSandboxHeader()
@ApiErrorResponses(400, 429, 500)
@UseGuards(SandboxGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista las tareas',
    description:
      'Filtros por estado y prioridad, búsqueda de texto, orden por fecha de creación o fecha límite y ' +
      'paginación por cursor: pide la página siguiente con el `nextCursor` de la anterior.',
  })
  @ApiOkResponse({ description: 'Una página de tareas.', standardSchema: TaskPageSchema })
  list(
    @SandboxId() sandboxId: string,
    @Query({ schema: ListTasksQuerySchema }) query: ListTasksQuery,
  ): Promise<TaskPage> {
    return this.tasks.list(sandboxId, query)
  }

  // Declared before `:id` so that "stats" is not taken as an id.
  @Get('stats')
  @ApiOperation({ summary: 'Cuenta las tareas por estado y prioridad, y las vencidas' })
  @ApiOkResponse({ description: 'Conteos del sandbox.', standardSchema: TaskStatsSchema })
  stats(@SandboxId() sandboxId: string): Promise<TaskStats> {
    return this.tasks.stats(sandboxId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtiene una tarea' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ description: 'La tarea.', standardSchema: TaskSchema })
  @ApiErrorResponses(404)
  get(@SandboxId() sandboxId: string, @Param('id', { schema: TaskId }) id: string): Promise<Task> {
    return this.tasks.get(sandboxId, id)
  }

  @Post()
  @ApiOperation({
    summary: 'Crea una tarea',
    description: 'Responde con la tarea creada y su URL en `Location`.',
  })
  @ApiCreatedResponse({ description: 'La tarea creada.', standardSchema: TaskSchema })
  @ApiErrorResponses(409)
  async create(
    @SandboxId() sandboxId: string,
    @Body({ schema: CreateTaskSchema }) input: CreateTask,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Task> {
    const task = await this.tasks.create(sandboxId, input)
    res.location(`${pathOf(req).replace(/\/+$/, '')}/${task.id}`)
    return task
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualiza solo los campos enviados' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ description: 'La tarea actualizada.', standardSchema: TaskSchema })
  @ApiErrorResponses(404)
  update(
    @SandboxId() sandboxId: string,
    @Param('id', { schema: TaskId }) id: string,
    @Body({ schema: UpdateTaskSchema }) patch: UpdateTask,
  ): Promise<Task> {
    return this.tasks.update(sandboxId, id, patch)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Borra una tarea' })
  @ApiParam(ID_PARAM)
  @ApiNoContentResponse({ description: 'Borrada; sin cuerpo.' })
  @ApiErrorResponses(404)
  remove(@SandboxId() sandboxId: string, @Param('id', { schema: TaskId }) id: string): Promise<void> {
    return this.tasks.remove(sandboxId, id)
  }
}
