import { HttpException, HttpStatus } from '@nestjs/common'
import { z } from 'zod'

/**
 * Error body of every response that is not 2xx. Same shape as `ApiError` in `@aim/contracts`, defined here
 * because that package ships uncompiled TypeScript that NodeNext cannot load. `message` is Spanish and safe
 * to show; `fields` maps each invalid field to its problems.
 */
export const ApiErrorSchema = z
  .object({
    error: z.string().min(1).meta({ description: 'Código estable para programas, en snake_case.' }),
    message: z.string().min(1).meta({ description: 'Explicación en español, lista para mostrar.' }),
    fields: z
      .record(z.string(), z.array(z.string()))
      .optional()
      .meta({ description: 'Problemas por campo (solo en errores de validación).' }),
  })
  .meta({
    id: 'ApiError',
    examples: [
      {
        error: 'invalid_request',
        message: 'Hay datos que no son válidos. Revisa los campos marcados.',
        fields: { title: ['El título debe tener al menos 3 caracteres.'] },
      },
    ],
  })
export type ApiError = z.infer<typeof ApiErrorSchema>

/** An HTTP error whose body is already an `ApiError`; the global filter sends it as is. */
export class ApiException extends HttpException {
  constructor(
    status: number,
    readonly body: ApiError,
  ) {
    super(body, status)
  }

  static invalidRequest(message: string, fields?: Record<string, string[]>): ApiException {
    return new ApiException(HttpStatus.BAD_REQUEST, { error: 'invalid_request', message, fields })
  }

  static notFound(message: string): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, { error: 'not_found', message })
  }
}

export const VALIDATION_MESSAGE = 'Hay datos que no son válidos. Revisa los campos marcados.'

/** 400 raised when a body, query or path parameter fails its schema. */
export class RequestValidationException extends ApiException {
  constructor(fields: Record<string, string[]>) {
    super(HttpStatus.BAD_REQUEST, { error: 'invalid_request', message: VALIDATION_MESSAGE, fields })
  }
}
