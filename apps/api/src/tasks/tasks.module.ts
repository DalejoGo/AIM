import { type DynamicModule, Module } from '@nestjs/common'
import { CLOCK, type Clock } from '../common/clock.js'
import { SANDBOX_LIMITS, type SandboxLimits } from '../config.js'
import { SandboxGuard } from '../sandbox/sandbox.guard.js'
import { InMemoryTasksRepository } from './in-memory-tasks.repository.js'
import { TasksController } from './tasks.controller.js'
import { TASKS_REPOSITORY } from './tasks.repository.js'
import { TasksService } from './tasks.service.js'

@Module({})
export class TasksModule {}

export function tasksModule(options: { clock: Clock; limits: SandboxLimits }): DynamicModule {
  return {
    module: TasksModule,
    controllers: [TasksController],
    providers: [
      TasksService,
      SandboxGuard,
      { provide: CLOCK, useValue: options.clock },
      { provide: SANDBOX_LIMITS, useValue: options.limits },
      // The port: swap this line for a Postgres adapter.
      { provide: TASKS_REPOSITORY, useClass: InMemoryTasksRepository },
    ],
  }
}
