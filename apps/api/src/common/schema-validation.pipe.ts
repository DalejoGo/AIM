import { type ArgumentMetadata, Injectable, StandardSchemaValidationPipe } from '@nestjs/common'
import { RequestValidationException } from './api-error.js'

type Issue = {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
}

/**
 * Nest's StandardSchemaValidationPipe (Zod 4 schemas passed as `@Body({ schema })`, `@Query({ schema })`...),
 * but failures become an `ApiError` with `fields`. The parameter metadata names the field when the issue has
 * no path of its own (a path parameter such as `id`).
 */
@Injectable()
export class SchemaValidationPipe extends StandardSchemaValidationPipe {
  override async transform<T>(value: T, metadata: ArgumentMetadata): Promise<T> {
    const schema = metadata.schema
    if (!schema || !this.toValidate(metadata)) return value
    this.stripProtoKeys(value)
    const result = await this.validate<T>(value, schema, this.validateOptions)
    if (result.issues) throw new RequestValidationException(issuesToFields(result.issues, metadata))
    return result.value
  }
}

export function issuesToFields(
  issues: readonly Issue[],
  metadata: ArgumentMetadata,
): Record<string, string[]> {
  const fields: Record<string, string[]> = {}
  for (const issue of issues) {
    const path = (issue.path ?? [])
      .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
      .join('.')
    const key = path || metadata.data || metadata.type
    fields[key] = [...(fields[key] ?? []), issue.message]
  }
  return fields
}
