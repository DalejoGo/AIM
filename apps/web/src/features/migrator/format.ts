import { formatCount } from './file'
import { MIN_SHARE, SAMPLE_SIZE } from './infer'
import type { CleanValue, Column, ColumnType, MigrationResult } from './types'

/** Interface texts derived from the pipeline result. Pure, so they can be tested without a DOM. */

const TYPE_NAMES: Record<ColumnType, string> = {
  email: 'Correo',
  phone: 'Teléfono',
  date: 'Fecha',
  amount: 'Monto',
  text: 'Texto',
}

const TYPE_NOUNS: Record<Exclude<ColumnType, 'text'>, string> = {
  email: 'correo',
  phone: 'teléfono',
  date: 'fecha',
  amount: 'monto',
}

export function typeLabel(column: Column): string {
  if (column.type === 'text' && column.titleCase) return 'Texto en formato título'
  return TYPE_NAMES[column.type]
}

/** Why the column got its type, in one sentence. */
export function reasonText(column: Column): string {
  const share = `${formatCount(column.matched)} de ${formatCount(column.sampled)} valores`
  switch (column.reason) {
    case 'identifier':
      return 'El encabezado indica un identificador: se deja como texto para no alterar los números.'
    case 'header':
      return `El encabezado lo sugiere y ${share} lo confirman.`
    case 'values':
      return `${share} tienen forma de ${column.type === 'text' ? 'texto' : TYPE_NOUNS[column.type]}.`
    case 'default':
      if (column.sampled === 0) return 'La columna está vacía.'
      if (column.titleCase) return 'Por el encabezado son nombres o lugares: se escriben en formato título.'
      return `Ningún otro tipo llegó al ${Math.round(MIN_SHARE * 100)} % de los valores.`
  }
}

export function delimiterName(delimiter: string): string {
  return delimiter === ';' ? 'punto y coma' : 'comas'
}

/** How a normalised value appears in the tables and in the clean CSV. */
export function cellText(value: CleanValue): string {
  return value === null ? '' : String(value)
}

/** "1 fila", "3 filas". */
export function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`
}

/** What changed while normalising, by type, largest first, skipping types with no changes. */
export function changeLines(result: MigrationResult): { label: string; count: number }[] {
  const labels: Record<ColumnType, string> = {
    phone: 'teléfonos pasados a formato internacional (E.164)',
    date: 'fechas pasadas a año-mes-día',
    amount: 'montos pasados a número',
    email: 'correos en minúscula y sin espacios',
    text: 'nombres y textos sin espacios de más o en formato título',
  }
  return (Object.keys(labels) as ColumnType[])
    .map((type) => ({ label: labels[type], count: result.changesByType[type] }))
    .filter((line) => line.count > 0)
    .sort((a, b) => b.count - a.count)
}

/** The sentence that accounts for every row read. */
export function summarySentence(result: MigrationResult): string {
  const parts = [
    plural(result.valid.length, 'válida', 'válidas'),
    `${formatCount(result.invalid.length)} con errores`,
    plural(result.duplicates.length, 'duplicada', 'duplicadas'),
    plural(result.emptyRows.length, 'vacía', 'vacías'),
  ]
  const last = parts.pop()
  return `${plural(result.totalRows, 'fila leída', 'filas leídas')}: ${parts.join(', ')} y ${last}.`
}

export const SAMPLE_NOTE = `hasta ${formatCount(SAMPLE_SIZE)} valores por columna`
