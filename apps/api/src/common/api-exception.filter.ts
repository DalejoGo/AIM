import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { ThrottlerException } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { type ApiError, ApiException } from './api-error.js'
import { pathOf } from './request-path.js'

const BAD_REQUEST: ApiError = { error: 'invalid_request', message: 'La petición no es válida.' }

const GENERIC: Record<number, ApiError> = {
  400: BAD_REQUEST,
  401: { error: 'unauthorized', message: 'Necesitas autenticarte para usar este recurso.' },
  403: { error: 'forbidden', message: 'No tienes permiso para usar este recurso.' },
  404: { error: 'not_found', message: 'El recurso no existe.' },
  405: { error: 'method_not_allowed', message: 'Este método no está permitido en esta ruta.' },
  409: { error: 'conflict', message: 'La petición choca con el estado actual del recurso.' },
  413: { error: 'payload_too_large', message: 'El cuerpo de la petición es demasiado grande.' },
  415: { error: 'unsupported_media_type', message: 'Envía el cuerpo como application/json.' },
  422: { error: 'unprocessable', message: 'La petición no se pudo procesar.' },
  429: { error: 'rate_limited', message: 'Hiciste demasiadas peticiones. Espera un momento.' },
}

const INTERNAL: ApiError = {
  error: 'internal',
  message: 'Ocurrió un error inesperado. Intenta de nuevo en un momento.',
}

/** Errors raised by Express middleware (body-parser) carry a `status` instead of being HttpExceptions. */
interface MiddlewareError {
  status: number
}

/** Turns every error into an `ApiError` body. 5xx never leak details: they are logged here instead. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions')

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const req = http.getRequest<Request>()
    const res = http.getResponse<Response>()
    const { status, body } = this.toApiError(exception, req, res)

    if (status >= 500) {
      const detail = exception instanceof Error ? exception.stack : String(exception)
      this.logger.error(`${req.method} ${pathOf(req)} failed`, detail)
    }
    this.adapterHost.httpAdapter.reply(res, body, status)
  }

  private toApiError(exception: unknown, req: Request, res: Response): { status: number; body: ApiError } {
    if (exception instanceof ApiException) return { status: exception.getStatus(), body: exception.body }

    if (exception instanceof ThrottlerException) {
      const retryAfter = Number(res.getHeader('Retry-After'))
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? `${retryAfter} s` : 'un momento'
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        body: {
          error: 'rate_limited',
          message: `Hiciste demasiadas peticiones. Intenta de nuevo en ${wait}.`,
        },
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      if (status === HttpStatus.NOT_FOUND) {
        return {
          status,
          body: { error: 'not_found', message: `No existe la ruta ${req.method} ${pathOf(req)}.` },
        }
      }
      // Nest turns body-parser's SyntaxError into a plain BadRequestException carrying the parser message.
      if (status === HttpStatus.BAD_REQUEST && /JSON/.test(exception.message)) {
        return {
          status,
          body: { error: 'invalid_request', message: 'El cuerpo de la petición no es un JSON válido.' },
        }
      }
      return { status, body: GENERIC[status] ?? (status >= 500 ? INTERNAL : BAD_REQUEST) }
    }

    // e.g. body-parser's 413 for a body over the limit.
    if (isMiddlewareError(exception)) {
      return { status: exception.status, body: GENERIC[exception.status] ?? BAD_REQUEST }
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: INTERNAL }
  }
}

function isMiddlewareError(value: unknown): value is MiddlewareError {
  if (!(value instanceof Error)) return false
  const status = (value as Partial<MiddlewareError>).status
  return typeof status === 'number' && status >= 400 && status < 500
}
