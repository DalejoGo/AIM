import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module.js'

export const API_PREFIX = 'api/v1'

/** Builds the configured application without listening, so tests and main.ts share the same setup. */
export async function createApp(
  options: { corsOrigins?: string[]; logger?: false } = {},
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, options.logger === false ? { logger: false } : {})
  app.setGlobalPrefix(API_PREFIX)
  app.enableCors({ origin: options.corsOrigins ?? [] })
  app.enableShutdownHooks()

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('AIM API')
      .setDescription('API de AIM · Desarrollo Web y Automatización')
      .setVersion('0.0.0')
      .build(),
  )
  SwaggerModule.setup('docs', app, document)

  return app
}
