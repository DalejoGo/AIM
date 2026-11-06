import Papa from 'papaparse'
import { formatCount, MAX_ROWS } from './file'
import { inferColumn } from './infer'
import {
  cleanText,
  normalizeAmount,
  normalizeDate,
  normalizeEmail,
  normalizeHeader,
  normalizePhone,
  toTitleCase,
  uniqueKeys,
} from './normalize'
import type {
  CleanValue,
  Column,
  ColumnType,
  DuplicateRow,
  FieldError,
  MigrationOutcome,
  ProcessedRow,
} from './types'
import { buildRowSchema, validateRow } from './validate'

export const DELIMITERS = [',', ';']

export interface SourceRow {
  /** Row number as a spreadsheet shows it (the first line of the file is row 1). */
  rowNumber: number
  fields: string[]
  /** PapaParse found an unbalanced quote in this row. */
  brokenQuotes: boolean
}

export type ReadOutcome =
  | { ok: true; delimiter: string; header: string[]; headerRow: number; rows: SourceRow[] }
  | { ok: false; error: string }

/**
 * Comma or semicolon. PapaParse guesses from the first non-empty rows; when it cannot tell (very short files,
 * a single column) the header decides: whichever separator it has more of, outside quotes. Ties go to comma.
 */
export function detectDelimiter(text: string): string {
  const guess = Papa.parse<string[]>(text, {
    preview: 20,
    delimitersToGuess: DELIMITERS,
    skipEmptyLines: 'greedy',
  })
  const undetectable = guess.errors.some((error) => error.code === 'UndetectableDelimiter')
  if (!undetectable && DELIMITERS.includes(guess.meta.delimiter)) return guess.meta.delimiter
  const header = (text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '').replace(/"[^"]*"/g, '')
  const count = (separator: string) => header.split(separator).length - 1
  return count(';') > count(',') ? ';' : ','
}

/** Step 1. Parses the text with PapaParse, comma or semicolon separated. The first non-empty row is the header. */
export function readCsv(text: string): ReadOutcome {
  const source = text.replace(/^\ufeff/, '')
  const delimiter = detectDelimiter(source)
  const parsed = Papa.parse<string[]>(source, { delimiter, skipEmptyLines: false })
  const records = parsed.data
  // A final line break leaves one empty record behind; it is not a row of the file.
  const last = records.at(-1)
  if (last && last.length === 1 && last[0] === '') records.pop()

  const headerIndex = records.findIndex((record) => !isEmptyRecord(record))
  const header = records[headerIndex]
  if (headerIndex < 0 || !header) {
    return {
      ok: false,
      error: 'El archivo está vacío. Sube un CSV con una fila de encabezados y al menos una fila de datos.',
    }
  }

  const dataCount = records.length - headerIndex - 1
  if (dataCount === 0) {
    return {
      ok: false,
      error: 'El archivo solo tiene la fila de encabezados. Agrega al menos una fila de datos.',
    }
  }
  if (dataCount > MAX_ROWS) {
    return {
      ok: false,
      error: `El archivo tiene ${formatCount(dataCount)} filas y el límite de esta demo es ${formatCount(MAX_ROWS)}. Divídelo en partes y súbelas por separado.`,
    }
  }

  const brokenQuotes = new Set(parsed.errors.filter((e) => e.type === 'Quotes').map((e) => e.row))
  const rows = records.slice(headerIndex + 1).map((fields, i) => {
    const index = headerIndex + 1 + i
    return { rowNumber: index + 1, fields, brokenQuotes: brokenQuotes.has(index) }
  })
  return { ok: true, delimiter, header, headerRow: headerIndex + 1, rows }
}

export function isEmptyRecord(fields: string[]): boolean {
  return fields.every((field) => cleanText(field) === '')
}

/** Step 2. Normalises the headers into unique keys and infers each column's type from a sample of its values. */
export function detectColumns(header: string[], rows: string[][]): Column[] {
  const keys = uniqueKeys(header.map((label, i) => normalizeHeader(label, i)))
  return header.map((label, index) => {
    const key = keys[index] ?? `columna_${index + 1}`
    const inference = inferColumn(
      key,
      rows.map((fields) => fields[index] ?? ''),
    )
    return { index, label: cleanText(label), key, ...inference }
  })
}

/** Step 3, per cell. Empty cells become null. */
export function normalizeValue(column: Column, raw: string): CleanValue {
  const text = cleanText(raw)
  if (!text) return null
  switch (column.type) {
    case 'email':
      return normalizeEmail(text)
    case 'phone':
      return normalizePhone(text)
    case 'date':
      return normalizeDate(text)
    case 'amount':
      return normalizeAmount(text)
    case 'text':
      return column.titleCase ? toTitleCase(text) : text
  }
}

/** Problems with the shape of the row itself: wrong number of fields or a quote left open. */
export function structuralError(row: SourceRow, columnCount: number): FieldError | null {
  const label = 'Fila'
  if (row.brokenQuotes) {
    return {
      key: '',
      label,
      message: 'Hay comillas sin cerrar en esta fila. Revisa que cada comilla que abre tenga su pareja.',
    }
  }
  const lastFilled = row.fields.findLastIndex((field) => cleanText(field) !== '')
  if (lastFilled >= columnCount) {
    return {
      key: '',
      label,
      message: `La fila tiene ${lastFilled + 1} campos con datos y el encabezado tiene ${columnCount}. Revisa si sobra un separador, por ejemplo una coma dentro de un monto sin comillas.`,
    }
  }
  if (row.fields.length < columnCount) {
    return {
      key: '',
      label,
      message: `La fila tiene ${row.fields.length} campos y el encabezado tiene ${columnCount}. Revisa si falta un separador entre dos valores.`,
    }
  }
  return null
}

export function normalizeRow(columns: Column[], row: SourceRow): ProcessedRow {
  const raw: Record<string, string> = {}
  const clean: Record<string, CleanValue> = {}
  const changed: string[] = []
  for (const column of columns) {
    const value = row.fields[column.index] ?? ''
    raw[column.key] = value
    clean[column.key] = normalizeValue(column, value)
    if (String(clean[column.key] ?? '') !== value) changed.push(column.key)
  }
  const problem = structuralError(row, columns.length)
  return { rowNumber: row.rowNumber, raw, clean, changed, errors: problem ? [problem] : [] }
}

/** Two rows are duplicates when every normalised value matches. The first one stays. */
export function rowSignature(columns: Column[], row: ProcessedRow): string {
  return JSON.stringify(columns.map((column) => row.clean[column.key] ?? null))
}

/** Runs the whole pipeline: read, detect columns, normalise (and drop duplicates), validate, split. */
export function runMigration(text: string): MigrationOutcome {
  const read = readCsv(text)
  if (!read.ok) return read

  const emptyRows: number[] = []
  const filled: SourceRow[] = []
  for (const row of read.rows) {
    if (isEmptyRecord(row.fields)) emptyRows.push(row.rowNumber)
    else filled.push(row)
  }

  const columns = detectColumns(
    read.header,
    filled.map((row) => row.fields),
  )
  const schema = buildRowSchema(columns)
  const typeOf = new Map(columns.map((column) => [column.key, column.type]))
  const changesByType: Record<ColumnType, number> = { email: 0, phone: 0, date: 0, amount: 0, text: 0 }
  let changedCells = 0

  const seen = new Map<string, number>()
  const duplicates: DuplicateRow[] = []
  const valid: ProcessedRow[] = []
  const invalid: ProcessedRow[] = []

  for (const source of filled) {
    const row = normalizeRow(columns, source)
    for (const key of row.changed) {
      const type = typeOf.get(key) ?? 'text'
      changesByType[type] += 1
      changedCells += 1
    }
    if (row.errors.length > 0) {
      invalid.push(row)
      continue
    }
    const signature = rowSignature(columns, row)
    const first = seen.get(signature)
    if (first !== undefined) {
      duplicates.push({ rowNumber: row.rowNumber, duplicateOf: first })
      continue
    }
    seen.set(signature, row.rowNumber)
    row.errors = validateRow(schema, columns, row.clean)
    if (row.errors.length > 0) invalid.push(row)
    else valid.push(row)
  }

  return {
    ok: true,
    result: {
      delimiter: read.delimiter,
      totalRows: read.rows.length,
      columns,
      emptyRows,
      duplicates,
      valid,
      invalid,
      changedCells,
      changesByType,
    },
  }
}

/** The row that best shows what normalising does: the valid one with most changed cells (first on ties). */
export function pickShowcaseRow(rows: ProcessedRow[]): ProcessedRow | undefined {
  let pick: ProcessedRow | undefined
  for (const row of rows) if (!pick || row.changed.length > pick.changed.length) pick = row
  return pick
}
