import { z } from 'zod'

/**
 * Data migrator (Lab): the result both engines produce, and the HTTP contract of the Python engine
 * (services/py-lab, FastAPI). The browser engine (apps/web/src/features/migrator) derives its types from here,
 * and services/py-lab/contract/*.schema.json is generated from these schemas (migrator.schema.test.ts fails if
 * the committed files are stale; `pnpm --filter @aim/contracts schemas:update` writes them again).
 *
 * Exported as `@aim/contracts/migrator` only, so pages that do not use it never load these schemas.
 */

// --- Result (same shape from the browser and from Python) ----------------------------------------------

export const COLUMN_TYPES = ['email', 'phone', 'date', 'amount', 'text'] as const
/** Kinds of data the migrator recognises in a column. */
export const ColumnType = z.enum(COLUMN_TYPES)
export type ColumnType = z.infer<typeof ColumnType>

/** Why a column ended up with its type, so the interface can explain the decision. */
export const InferenceReason = z.enum(['header', 'values', 'identifier', 'default'])
export type InferenceReason = z.infer<typeof InferenceReason>

export const DELIMITERS = [',', ';'] as const
export const Delimiter = z.enum(DELIMITERS)
export type Delimiter = z.infer<typeof Delimiter>

const count = z.int().nonnegative()
/** Row number as a spreadsheet shows it: the header is row 1, so data rows start at 2 at the earliest. */
const rowNumber = z.int().positive()

export const MigrationColumn = z.object({
  /** Position in the source file. */
  index: count,
  /** Header as written in the file, trimmed. */
  label: z.string(),
  /** Normalised, unique snake_case name used in the clean export. */
  key: z.string().min(1),
  type: ColumnType,
  /** Text columns that hold names or places are written in title case. */
  titleCase: z.boolean(),
  reason: InferenceReason,
  /** Non-empty values looked at, and how many of them matched the chosen type. */
  sampled: count,
  matched: count,
})
export type MigrationColumn = z.infer<typeof MigrationColumn>

/** A normalised cell: text, a number (amounts) or null when empty. */
export const CleanValue = z.union([z.string(), z.number(), z.null()])
export type CleanValue = z.infer<typeof CleanValue>

export const FieldError = z.object({
  /** Column key, or an empty string when the problem is the whole row. */
  key: z.string(),
  label: z.string(),
  message: z.string().min(1),
})
export type FieldError = z.infer<typeof FieldError>

export const ProcessedRow = z.object({
  rowNumber,
  /** Values as they came in the file, by column key. */
  raw: z.record(z.string(), z.string()),
  /** Values after normalising; empty cells become null. */
  clean: z.record(z.string(), CleanValue),
  /** Keys whose value changed while normalising. */
  changed: z.array(z.string()),
  errors: z.array(FieldError),
})
export type ProcessedRow = z.infer<typeof ProcessedRow>

export const DuplicateRow = z.object({
  rowNumber,
  /** The earlier row it repeats once both are normalised. */
  duplicateOf: rowNumber,
})
export type DuplicateRow = z.infer<typeof DuplicateRow>

export const ChangesByType = z.object({ email: count, phone: count, date: count, amount: count, text: count })
export type ChangesByType = z.infer<typeof ChangesByType>

export const MigrationResult = z.object({
  /** The source's separator; for Excel, the comma the clean CSV is written with. */
  delimiter: Delimiter,
  /** Data rows read, without the header. */
  totalRows: count,
  columns: z.array(MigrationColumn),
  /** Row numbers of rows with no content at all. */
  emptyRows: z.array(rowNumber),
  duplicates: z.array(DuplicateRow),
  valid: z.array(ProcessedRow),
  invalid: z.array(ProcessedRow),
  /** Cells whose value changed while normalising, in total and by column type. */
  changedCells: count,
  changesByType: ChangesByType,
})
export type MigrationResult = z.infer<typeof MigrationResult>

// --- Python engine: POST /v1/migrations ------------------------------------------------------------------

export const PYLAB_HEALTH_PATH = '/health'
export const PYLAB_MIGRATIONS_PATH = '/v1/migrations'
/** multipart/form-data fields of POST /v1/migrations. `sheet` picks a sheet of an Excel workbook. */
export const PYLAB_FILE_FIELD = 'file'
export const PYLAB_SHEET_FIELD = 'sheet'
export const PYLAB_MAX_SHEET_NAME = 255

export const SOURCE_FORMATS = ['csv', 'xls', 'xlsx'] as const
/** Decided by the file's content, not its name. */
export const SourceFormat = z.enum(SOURCE_FORMATS)
export type SourceFormat = z.infer<typeof SourceFormat>

export const MigrationOptions = z.object({ sheet: z.string().min(1).max(PYLAB_MAX_SHEET_NAME).optional() })
export type MigrationOptions = z.infer<typeof MigrationOptions>

/** How the text of a CSV was decoded (WHATWG names). */
export const SourceEncoding = z.object({
  name: z.enum(['utf-8', 'utf-16le', 'utf-16be', 'windows-1252', 'ibm850', 'macintosh']),
  /** A byte order mark, valid UTF-8, charset-normalizer's guess, or Windows-1252 when nothing fit better. */
  detectedBy: z.enum(['bom', 'utf-8', 'charset-normalizer', 'fallback']),
})
export type SourceEncoding = z.infer<typeof SourceEncoding>

export const MigrationSource = z.object({
  name: z.string(),
  bytes: count,
  format: SourceFormat,
  /** CSV only. */
  encoding: SourceEncoding.nullable(),
  /** Excel only: the sheet processed, and the workbook's visible sheets. */
  sheet: z.string().nullable(),
  sheets: z.array(z.string()),
})
export type MigrationSource = z.infer<typeof MigrationSource>

const milliseconds = z.number().nonnegative()
export const MigrationTimings = z.object({
  readMs: milliseconds,
  processMs: milliseconds,
  totalMs: milliseconds,
})
export type MigrationTimings = z.infer<typeof MigrationTimings>

export const MigrationEngine = z.object({
  name: z.literal('py-lab'),
  version: z.string(),
  python: z.string(),
})
export type MigrationEngine = z.infer<typeof MigrationEngine>

/** What only the server knows: how the file was read and how long it took. */
export const MigrationMeta = z.object({
  source: MigrationSource,
  timings: MigrationTimings,
  engine: MigrationEngine,
})
export type MigrationMeta = z.infer<typeof MigrationMeta>

/** 200 answer of POST /v1/migrations. */
export const MigrationResponse = z.object({ result: MigrationResult, meta: MigrationMeta })
export type MigrationResponse = z.infer<typeof MigrationResponse>

/** GET /health: the service is up, with the limits it enforces. */
export const PyLabLimits = z.object({
  maxUploadBytes: z.int().positive(),
  maxRows: z.int().positive(),
  maxColumns: z.int().positive(),
  maxCells: z.int().positive(),
  formats: z.array(SourceFormat),
})
export type PyLabLimits = z.infer<typeof PyLabLimits>

export const PyLabHealth = z.object({ status: z.literal('ok'), version: z.string(), limits: PyLabLimits })
export type PyLabHealth = z.infer<typeof PyLabHealth>

/**
 * Error body of every non-2xx answer: the same shape as `ApiError` in ./api (kept separate so this module does
 * not pull the rest of the contracts into the page; contracts.test.ts checks both stay equal).
 */
export const PyLabError = z.object({
  error: z.string().min(1),
  message: z.string().min(1),
  fields: z.record(z.string(), z.array(z.string())).optional(),
})
export type PyLabError = z.infer<typeof PyLabError>

/** Stable `error` codes of POST /v1/migrations, besides the generic ones (not_found, rate_limited, internal). */
export const MIGRATION_ERROR_CODES = [
  'invalid_request',
  'unsupported_media_type',
  'unsupported_file',
  'file_too_large',
  'empty_file',
  'header_only',
  'too_many_rows',
  'too_many_columns',
  'too_many_cells',
  'sheet_not_found',
  'protected_file',
  'unreadable_file',
  'excel_too_large',
  'excel_too_slow',
  'rate_limited',
  'busy',
  'internal',
] as const
export type MigrationErrorCode = (typeof MIGRATION_ERROR_CODES)[number]
