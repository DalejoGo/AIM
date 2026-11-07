import { z } from 'zod'
import {
  ChangesByType,
  CleanValue,
  ColumnType,
  DuplicateRow,
  FieldError,
  MigrationColumn,
  MigrationEngine,
  MigrationMeta,
  MigrationResponse,
  MigrationResult,
  MigrationSource,
  MigrationTimings,
  ProcessedRow,
  PyLabError,
  PyLabHealth,
  PyLabLimits,
  SourceEncoding,
} from './migrator'

/**
 * JSON Schemas (draft 2020-12) of the migrator contract, for the Python service (services/py-lab/contract),
 * where pytest validates every response against them. Named schemas go to `$defs` under their export name.
 */

const NAMED = {
  ChangesByType,
  CleanValue,
  ColumnType,
  DuplicateRow,
  FieldError,
  MigrationColumn,
  MigrationEngine,
  MigrationMeta,
  MigrationResponse,
  MigrationResult,
  MigrationSource,
  MigrationTimings,
  ProcessedRow,
  PyLabError,
  PyLabHealth,
  PyLabLimits,
  SourceEncoding,
}

/** File name in services/py-lab/contract → root schema. */
export const MIGRATOR_SCHEMA_FILES = {
  'migration-result.schema.json': MigrationResult,
  'migration-response.schema.json': MigrationResponse,
  'health.schema.json': PyLabHealth,
  'error.schema.json': PyLabError,
} as const

export function migratorJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const metadata = z.registry<{ id: string }>()
  for (const [id, named] of Object.entries(NAMED)) metadata.add(named, { id })
  return z.toJSONSchema(schema, { target: 'draft-2020-12', metadata, io: 'output' })
}

/** The text written to each file: two-space JSON and a final newline. */
export function migratorSchemaFiles(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(MIGRATOR_SCHEMA_FILES).map(([file, schema]) => [
      file,
      `${JSON.stringify(migratorJsonSchema(schema), null, 2)}\n`,
    ]),
  )
}
