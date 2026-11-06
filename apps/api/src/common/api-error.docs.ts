import { applyDecorators } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger'
import { type ApiError, ApiErrorSchema } from './api-error.js'

type ErrorStatus = 400 | 404 | 409 | 429 | 500

const RESPONSES: Record<
  ErrorStatus,
  { decorator: typeof ApiBadRequestResponse; description: string; example: ApiError }
> = {
  400: {
    decorator: ApiBadRequestResponse,
    description: 'Datos no válidos o falta la cabecera X-Sandbox-Id.',
    example: {
      error: 'invalid_request',
      message: 'Hay datos que no son válidos. Revisa los campos marcados.',
      fields: { title: ['El título debe tener al menos 3 caracteres.'] },
    },
  },
  404: {
    decorator: ApiNotFoundResponse,
    description: 'La tarea no existe en tu sandbox.',
    example: {
      error: 'not_found',
      message: 'No encontramos la tarea 5d0f8a5e-8a39-4c55-9a43-0f5b8c1d2e3f en tu sandbox.',
    },
  },
  409: {
    decorator: ApiConflictResponse,
    description: 'El sandbox llegó al máximo de tareas.',
    example: {
      error: 'sandbox_full',
      message: 'Tu sandbox ya tiene 50 tareas, el máximo permitido. Borra alguna para crear otra.',
    },
  },
  429: {
    decorator: ApiTooManyRequestsResponse,
    description:
      'Más de 60 peticiones por minuto desde tu IP. La cabecera Retry-After dice cuántos segundos esperar.',
    example: { error: 'rate_limited', message: 'Hiciste demasiadas peticiones. Intenta de nuevo en 42 s.' },
  },
  500: {
    decorator: ApiInternalServerErrorResponse,
    description: 'Error inesperado; nunca incluye detalles internos.',
    example: { error: 'internal', message: 'Ocurrió un error inesperado. Intenta de nuevo en un momento.' },
  },
}

/** Documents the given error statuses with the `ApiError` schema and a realistic example each. */
export const ApiErrorResponses = (...statuses: ErrorStatus[]) =>
  applyDecorators(
    ...statuses.map((status) => {
      const { decorator, description, example } = RESPONSES[status]
      return decorator({ description, standardSchema: ApiErrorSchema, example })
    }),
  )
