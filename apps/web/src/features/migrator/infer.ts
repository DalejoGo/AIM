import { cleanText, parseAmount, parseDate } from './normalize'
import type { ColumnType, InferenceReason } from './types'

/** Values looked at per column. Spread across the file so a messy start does not decide alone. */
export const SAMPLE_SIZE = 200
/** Share of sampled values that must look like a type when the header gives no hint. */
export const MIN_SHARE = 0.8
/** Lower bar when the header already names the type ("Correo", "Teléfono"...). */
export const MIN_SHARE_WITH_HINT = 0.5

type SpecialType = Exclude<ColumnType, 'text'>

/** Ties go to the first type in this list. */
const PRIORITY: SpecialType[] = ['email', 'date', 'phone', 'amount']

/** Words in a header (snake_case key, split on "_") that suggest a type. */
const HINTS: Record<SpecialType, string[]> = {
  email: ['correo', 'email', 'mail'],
  phone: ['telefono', 'tel', 'celular', 'cel', 'movil', 'phone', 'whatsapp'],
  date: ['fecha', 'date', 'nacimiento', 'creado', 'creacion', 'actualizado', 'vencimiento'],
  amount: [
    'monto',
    'valor',
    'total',
    'saldo',
    'precio',
    'importe',
    'pago',
    'amount',
    'price',
    'deuda',
    'salario',
  ],
}

/** Headers that hold identifiers: numbers that must stay exactly as written. */
const IDENTIFIER_WORDS = [
  'id',
  'codigo',
  'documento',
  'cedula',
  'nit',
  'identificacion',
  'cc',
  'sku',
  'referencia',
]

/** Text headers whose values are names or places, written in title case. */
const TITLE_WORDS = [
  'nombre',
  'nombres',
  'apellido',
  'apellidos',
  'name',
  'ciudad',
  'city',
  'municipio',
  'pais',
]

const LOOSE_PHONE = /^\(?\+?[\d\s().-]+$/
const THOUSANDS_GROUPS = /^\d{1,3}(?:\.\d{3})+$/
const LOOSE_DATE = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/
/** A currency sign followed by digits, even if the number itself is malformed ("$1.2.3"). */
const LOOSE_MONEY = /^\(?-?\s*(?:us\$|\$|€|cop|usd)\s*\d/i

/** Loose shape checks: invalid values still count, so one bad email does not turn a column into text. */
export function looksLike(type: SpecialType, value: string): boolean {
  switch (type) {
    case 'email':
      return value.includes('@')
    case 'phone': {
      if (!LOOSE_PHONE.test(value) || THOUSANDS_GROUPS.test(value)) return false
      const digits = value.replace(/\D/g, '').length
      return digits >= 7 && digits <= 15
    }
    case 'date':
      return LOOSE_DATE.test(value) || parseDate(value) !== null
    case 'amount':
      return parseAmount(value) !== null || LOOSE_MONEY.test(value)
  }
}

/** Up to `size` values spread evenly across the list. */
export function sampleValues(values: string[], size = SAMPLE_SIZE): string[] {
  if (values.length <= size) return values
  const step = values.length / size
  return Array.from({ length: size }, (_, i) => values[Math.floor(i * step)] ?? '')
}

export function headerWords(key: string): string[] {
  return key.split('_').filter(Boolean)
}

export interface Inference {
  type: ColumnType
  titleCase: boolean
  reason: InferenceReason
  sampled: number
  matched: number
}

/**
 * Decides a column's type from its key and its values:
 * 1. Identifier headers (id, documento, cédula...) stay as text.
 * 2. A type named by the header wins if at least half the sample looks like it.
 * 3. Otherwise the type with the largest share wins if it reaches 80 %; ties follow PRIORITY.
 * 4. Anything else is text.
 */
export function inferColumn(key: string, values: string[]): Inference {
  const words = headerWords(key)
  const titleCase = words.some((word) => TITLE_WORDS.includes(word))
  const sample = sampleValues(values.map(cleanText).filter(Boolean))
  const sampled = sample.length
  const text = (reason: InferenceReason, matched = 0): Inference => ({
    type: 'text',
    titleCase,
    reason,
    sampled,
    matched,
  })

  if (words.some((word) => IDENTIFIER_WORDS.includes(word))) return text('identifier', sampled)
  if (sampled === 0) return text('default')

  const matches = new Map(
    PRIORITY.map((type) => [type, sample.filter((value) => looksLike(type, value)).length] as const),
  )
  const share = (type: SpecialType) => (matches.get(type) ?? 0) / sampled

  const hinted = PRIORITY.filter((type) => HINTS[type].some((hint) => words.includes(hint)))
  const byHint = best(
    hinted.filter((type) => share(type) >= MIN_SHARE_WITH_HINT),
    share,
  )
  if (byHint) {
    return { type: byHint, titleCase: false, reason: 'header', sampled, matched: matches.get(byHint) ?? 0 }
  }

  const byValues = best(
    PRIORITY.filter((type) => share(type) >= MIN_SHARE),
    share,
  )
  if (byValues) {
    return {
      type: byValues,
      titleCase: false,
      reason: 'values',
      sampled,
      matched: matches.get(byValues) ?? 0,
    }
  }

  return text('default', sampled)
}

/** Highest share; the earliest in the list wins ties because the list follows PRIORITY. */
function best(types: SpecialType[], share: (type: SpecialType) => number): SpecialType | undefined {
  let winner: SpecialType | undefined
  for (const type of types) if (winner === undefined || share(type) > share(winner)) winner = type
  return winner
}
