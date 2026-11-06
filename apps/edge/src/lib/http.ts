import type { ApiError } from '@aim/contracts'
import { zValidator } from '@hono/zod-validator'
import type { Context, ValidationTargets } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ZodType } from 'zod'

/** Every non-2xx response has the ApiError shape, with a Spanish message that is safe to show. */
export function fail(
  c: Context,
  status: ContentfulStatusCode,
  error: string,
  message: string,
  fields?: ApiError['fields'],
) {
  const body: ApiError = fields ? { error, message, fields } : { error, message }
  return c.json(body, status)
}

/** zod-validator that answers 400 with field errors instead of Zod's raw output. */
export function validate<T extends ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result, c) => {
    if (result.success) return
    const fields: Record<string, string[]> = {}
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_'
      fields[key] = [...(fields[key] ?? []), issue.message]
    }
    return fail(c, 400, 'invalid_request', 'Revisa los datos marcados e inténtalo de nuevo.', fields)
  })
}
