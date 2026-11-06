import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common'
import { ApiHeader } from '@nestjs/swagger'
import type { Request } from 'express'
import { z } from 'zod'
import { ApiException } from '../common/api-error.js'

export const SANDBOX_HEADER = 'X-Sandbox-Id'

const SandboxIdSchema = z.uuid()

const MISSING = `Falta la cabecera ${SANDBOX_HEADER}. Envía un UUID propio (por ejemplo, el que genera crypto.randomUUID()) para tener tu espacio de pruebas.`
const INVALID = `La cabecera ${SANDBOX_HEADER} debe ser un UUID, por ejemplo 0b6e7d2a-3f4c-4b8e-9a1d-5c2f8e7a6b10.`

interface SandboxRequest extends Request {
  sandboxId?: string
}

/** Requires a valid `X-Sandbox-Id` and keeps it, normalized, on the request for `@SandboxId()`. */
@Injectable()
export class SandboxGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<SandboxRequest>()
    const raw = req.get(SANDBOX_HEADER)?.trim()
    if (!raw) throw ApiException.invalidRequest(MISSING, { [SANDBOX_HEADER]: [MISSING] })
    if (!SandboxIdSchema.safeParse(raw).success) {
      throw ApiException.invalidRequest(INVALID, { [SANDBOX_HEADER]: [INVALID] })
    }
    req.sandboxId = raw.toLowerCase()
    return true
  }
}

/** The sandbox id validated by `SandboxGuard`. */
export const SandboxId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const sandboxId = context.switchToHttp().getRequest<SandboxRequest>().sandboxId
  if (!sandboxId) throw new Error('SandboxId used on a route without SandboxGuard')
  return sandboxId
})

/** Documents the header in OpenAPI. */
export const ApiSandboxHeader = () =>
  applyDecorators(
    ApiHeader({
      name: SANDBOX_HEADER,
      required: true,
      description:
        'UUID que identifica tu sandbox: un espacio en memoria solo para ti, con 3 tareas de ejemplo y ' +
        'máximo 50 tareas. Se borra tras 30 minutos sin uso. Genera uno con crypto.randomUUID() y ' +
        'repítelo en cada petición.',
      schema: { type: 'string', format: 'uuid', example: '0b6e7d2a-3f4c-4b8e-9a1d-5c2f8e7a6b10' },
    }),
  )
