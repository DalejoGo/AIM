import 'reflect-metadata'
import type { LoggerService } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'
import { z } from 'zod'
import { appModule } from './app.module.js'
import { type Clock, systemClock } from './common/clock.js'
import { httpTiming, RESPONSE_TIME_HEADER } from './common/http-timing.middleware.js'
import { type ApiConfig, loadConfig } from './config.js'
import { SANDBOX_HEADER } from './sandbox/sandbox.guard.js'

export const API_PREFIX = 'api/v1'

export interface AppOptions {
  /** Defaults to the built-in values (nothing read from the environment); main.ts passes `loadConfig()`. */
  config?: ApiConfig
  /** Tests inject a fake clock to expire sandboxes and make tasks overdue. */
  clock?: Clock
  logger?: false | LoggerService
}

/** Builds the configured application without listening, so tests and main.ts share the same setup. */
export async function createApp(options: AppOptions = {}): Promise<NestExpressApplication> {
  const config = options.config ?? loadConfig({})
  // Spanish messages for any Zod check without a custom one.
  z.config(z.locales.es())

  const app = await NestFactory.create<NestExpressApplication>(
    appModule({ config, clock: options.clock ?? systemClock }),
    options.logger === undefined ? {} : { logger: options.logger },
  )
  // Render (and any reverse proxy) sits one hop in front: req.ip must be the visitor, not the proxy, or every
  // visitor would share the same rate limit.
  app.set('trust proxy', 1)
  app.use(httpTiming())
  // Helmet defaults, minus upgrade-insecure-requests: it would send /docs assets to https on
  // http://localhost. Render only serves HTTPS, and HSTS already covers it.
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }))
  app.enableCors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', SANDBOX_HEADER],
    // The console (another origin) reads these from JavaScript.
    exposedHeaders: [
      RESPONSE_TIME_HEADER,
      'Location',
      'Retry-After',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ],
    maxAge: 600,
  })
  // A task is under 2 kB of JSON; anything far bigger is not a legitimate request.
  app.useBodyParser('json', { limit: '16kb' })
  app.setGlobalPrefix(API_PREFIX)
  app.enableShutdownHooks()

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('AIM API')
      .setDescription(
        'API de AIM Desarrollo y Automatizaciones.\n\n' +
          '**Tareas** es una API REST de ejemplo para el API Playground del Lab. Cada visitante trabaja en su ' +
          `propio sandbox en memoria: envía la cabecera \`${SANDBOX_HEADER}\` con un UUID tuyo en cada ` +
          'petición. El sandbox arranca con 3 tareas de ejemplo, admite hasta 50 y se borra tras 30 minutos ' +
          'sin uso.\n\n' +
          `Límite: ${config.rateLimit.limit} peticiones por minuto por IP (429 con \`Retry-After\`). ` +
          `Cada respuesta trae \`${RESPONSE_TIME_HEADER}\`. Los errores siempre tienen la forma \`ApiError\`.`,
      )
      .setVersion('1.0.0')
      .addTag('tasks', 'API de ejemplo con sandbox por visitante.')
      .addTag('health', 'Estado del servicio.')
      .build(),
  )
  SwaggerModule.setup('docs', app, document)

  return app
}
