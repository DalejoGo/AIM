/** Kinds of data the migrator recognises in a column. */
export type ColumnType = 'email' | 'phone' | 'date' | 'amount' | 'text'

/** Why a column ended up with its type, so the interface can explain the decision. */
export type InferenceReason = 'header' | 'values' | 'identifier' | 'default'

export interface Column {
  /** Position in the source file. */
  index: number
  /** Header as written in the file, trimmed. */
  label: string
  /** Normalised, unique snake_case name used in the clean export. */
  key: string
  type: ColumnType
  /** Text columns that hold names or places are written in title case. */
  titleCase: boolean
  reason: InferenceReason
  /** Non-empty values looked at, and how many of them matched the chosen type. */
  sampled: number
  matched: number
}

export type CleanValue = string | number | null

export interface FieldError {
  /** Column key, or an empty string when the problem is the whole row. */
  key: string
  label: string
  message: string
}

export interface ProcessedRow {
  /** Row number as a spreadsheet shows it: the header is row 1. */
  rowNumber: number
  /** Values as they came in the file, by column key. */
  raw: Record<string, string>
  /** Values after normalising; empty cells become null. */
  clean: Record<string, CleanValue>
  /** Keys whose value changed while normalising. */
  changed: string[]
  errors: FieldError[]
}

export interface DuplicateRow {
  rowNumber: number
  /** The earlier row it repeats once both are normalised. */
  duplicateOf: number
}

export interface MigrationResult {
  delimiter: string
  /** Data rows read, without the header. */
  totalRows: number
  columns: Column[]
  /** Row numbers of rows with no content at all. */
  emptyRows: number[]
  duplicates: DuplicateRow[]
  valid: ProcessedRow[]
  invalid: ProcessedRow[]
  /** Cells whose value changed while normalising, in total and by column type. */
  changedCells: number
  changesByType: Record<ColumnType, number>
}

export type MigrationOutcome = { ok: true; result: MigrationResult } | { ok: false; error: string }
