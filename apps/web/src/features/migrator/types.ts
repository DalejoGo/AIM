import type { MigrationColumn, MigrationResult } from '@aim/contracts/migrator'

/**
 * The migrator's data shapes come from the contract shared with the Python engine (@aim/contracts/migrator),
 * so the browser and services/py-lab cannot drift apart. Type-only imports: no Zod is loaded for them.
 *
 * - ColumnType: kinds of data the migrator recognises in a column.
 * - InferenceReason: why a column ended up with its type, so the interface can explain the decision.
 * - ProcessedRow.rowNumber: row number as a spreadsheet shows it (the header is row 1).
 * - MigrationResult: what the pipeline returns, from either engine.
 */
export type {
  CleanValue,
  ColumnType,
  Delimiter,
  DuplicateRow,
  FieldError,
  InferenceReason,
  MigrationResult,
  ProcessedRow,
} from '@aim/contracts/migrator'

/** A detected column: position, header, normalised key, type and how the type was decided. */
export type Column = MigrationColumn

export type MigrationOutcome = { ok: true; result: MigrationResult } | { ok: false; error: string }
