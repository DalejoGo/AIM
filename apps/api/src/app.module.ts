import { type DynamicModule, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { ApiExceptionFilter } from './common/api-exception.filter.js'
import type { Clock } from './common/clock.js'
import { SchemaValidationPipe } from './common/schema-validation.pipe.js'
import type { ApiConfig } from './config.js'
import { HealthController } from './health/health.controller.js'
import { tasksModule } from './tasks/tasks.module.js'

@Module({})
export class AppModule {}

/** The root module wired with the runtime config and clock (tests pass their own). */
export function appModule(options: { config: ApiConfig; clock: Clock }): DynamicModule {
  const { config, clock } = options
  return {
    module: AppModule,
    imports: [
      ThrottlerModule.forRoot({
        throttlers: [{ ttl: config.rateLimit.ttlMs, limit: config.rateLimit.limit }],
        // One budget per client IP for the whole API (the default key is per route).
        generateKey: (_context, tracker, name) => `${name}:${tracker}`,
      }),
      tasksModule({ clock, limits: config.sandbox }),
    ],
    controllers: [HealthController],
    providers: [
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: APP_PIPE, useClass: SchemaValidationPipe },
      { provide: APP_FILTER, useClass: ApiExceptionFilter },
    ],
  }
}
