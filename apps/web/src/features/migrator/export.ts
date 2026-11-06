import Papa from 'papaparse'
import type { CleanValue, MigrationResult } from './types'

/**
 * Cells that a spreadsheet would run as a formula get a leading apostrophe (CSV injection). Numbers and phones
 * such as "-1200" or "+57 (300) 555-0101" are left alone because they are data, not formulas.
 */
export const FORMULA_START = /^(?:[=@\t\r]|[+-](?![\d\s().,-]*$))/

/** Byte order mark so Excel opens the file as UTF-8 and keeps the accents. */
export const BOM = '\ufeff'

function cell(value: CleanValue): string | number {
  return value ?? ''
}

/** Valid rows with normalised headers and values, using the same separator as the source file. */
export function toCleanCsv(result: MigrationResult): string {
  const fields = result.columns.map((column) => column.key)
  return Papa.unparse(
    { fields, data: result.valid.map((row) => fields.map((key) => cell(row.clean[key] ?? null))) },
    { delimiter: result.delimiter, newline: '\r\n', escapeFormulae: FORMULA_START },
  )
}

/** Rows with errors as they came in the file, with their row number and what to fix, ready to correct. */
export function toErrorsCsv(result: MigrationResult): string {
  const fields = ['fila', ...result.columns.map((column) => column.label || column.key), 'errores']
  const data = result.invalid.map((row) => [
    row.rowNumber,
    ...result.columns.map((column) => row.raw[column.key] ?? ''),
    row.errors.map((error) => `${error.label}: ${error.message}`).join(' / '),
  ])
  return Papa.unparse(
    { fields, data },
    { delimiter: result.delimiter, newline: '\r\n', escapeFormulae: FORMULA_START },
  )
}

/** "clientes.csv" becomes "clientes-limpio.csv". */
export function exportName(sourceName: string, suffix: string): string {
  const base = sourceName.replace(/\.[^.]+$/, '') || 'datos'
  return `${base}-${suffix}.csv`
}
