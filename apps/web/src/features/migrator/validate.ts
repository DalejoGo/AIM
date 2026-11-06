import { z } from 'zod'
import {
  cleanText,
  DEFAULT_COUNTRY_CODE,
  dateParts,
  daysInMonth,
  E164,
  MAX_YEAR,
  MIN_YEAR,
} from './normalize'
import type { CleanValue, Column, ColumnType, FieldError } from './types'

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

const show = (value: unknown) => `«${String(value)}»`
const digitCount = (value: string) => value.replace(/\D/g, '').length

export function describeEmailProblem(input: unknown): string {
  const value = String(input)
  const at = value.split('@').length - 1
  if (at === 0) return `${show(value)} no es un correo: le falta la @. Escríbelo como nombre@dominio.com.`
  if (at > 1) return `${show(value)} tiene más de una @. Deja solo una, entre el usuario y el dominio.`
  if (/\s/.test(value)) return `${show(value)} tiene espacios. Quítalos: un correo va todo junto.`
  const [user = '', domain = ''] = value.split('@')
  if (!user)
    return `${show(value)} no tiene nada antes de la @. Agrega el usuario, por ejemplo ana@dominio.com.`
  if (!/\.[a-z]{2,}$/i.test(domain)) {
    return `${show(value)} no tiene una extensión de dominio válida. Revisa el final, por ejemplo @dominio.com o @dominio.co.`
  }
  return `${show(value)} no es un correo válido. Revisa que no tenga tildes, comas ni símbolos raros.`
}

export function describePhoneProblem(input: unknown): string {
  const value = String(input)
  const digits = digitCount(value)
  if (/[^+\d\s().\-/]/.test(value)) {
    return `${show(value)} tiene letras o símbolos. Deja solo números, espacios, guiones o paréntesis.`
  }
  if (value.startsWith(`+${DEFAULT_COUNTRY_CODE}`)) {
    const national = digits - DEFAULT_COUNTRY_CODE.length
    return `Un número de Colombia (+57) lleva 10 dígitos después del indicativo y ${show(value)} tiene ${national}. Revisa que no falte ni sobre ninguno.`
  }
  if (value.startsWith('+')) {
    return `${show(value)} tiene ${digits} dígitos contando el indicativo. Un número internacional lleva entre 8 y 15.`
  }
  if (digits === 10) {
    return `${show(value)} no tiene indicativo de país y no es un celular de Colombia (empiezan por 3). Escríbelo con + y el indicativo, por ejemplo +57 601 555 0101.`
  }
  return `${show(value)} tiene ${digits} dígitos. Un celular de Colombia lleva 10, por ejemplo 300 555 0101. Si es de otro país, agrega + y el indicativo.`
}

export function describeDateProblem(input: unknown): string {
  const value = String(input)
  const parts = dateParts(value)
  const formats = 'Usa día/mes/año (03/04/2024), año-mes-día (2024-04-03) o «3 de abril de 2024».'
  if (!parts) return `No se reconoce ${show(value)} como fecha. ${formats}`
  const { year, month, day } = parts
  if (year < MIN_YEAR || year > MAX_YEAR) {
    return `El año ${year} de ${show(value)} está fuera del rango aceptado (${MIN_YEAR} a ${MAX_YEAR}). Revisa que el año esté completo.`
  }
  if (month > 12 && day <= 12) {
    return `${show(value)} no existe si se lee como día/mes/año: no hay mes ${month}. Si viene en formato mes/día, escríbela como ${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}.`
  }
  if (month < 1 || month > 12) return `${show(value)} tiene el mes ${month}, que no existe. ${formats}`
  const days = daysInMonth(year, month)
  if (day < 1 || day > days) {
    return `${show(value)} no existe: ${MONTH_NAMES[month - 1]} de ${year} tiene ${days} días. Revisa el día.`
  }
  return `No se reconoce ${show(value)} como fecha. ${formats}`
}

export function describeAmountProblem(input: unknown): string {
  const value = cleanText(String(input))
  if (/\p{L}/u.test(value.replace(/\b(?:cop|usd|eur|us|pesos?)\b/gi, ''))) {
    return `${show(value)} tiene letras. Escríbelo solo con números, por ejemplo 1.200.000,50.`
  }
  return `No se entiende ${show(value)} como monto. Usa puntos para los miles y coma para los decimales (1.200.000,50), o solo el punto decimal (1200000.5).`
}

/** Zod schema for one cell of a column type. Messages say what is wrong and how to fix it. */
export function fieldSchema(type: ColumnType): z.ZodType<CleanValue> {
  switch (type) {
    case 'email':
      return z.email({ error: (issue) => describeEmailProblem(issue.input) }).nullable()
    case 'phone':
      return z
        .string()
        .regex(E164, { error: (issue) => describePhoneProblem(issue.input) })
        .nullable()
    case 'date':
      return z.iso.date({ error: (issue) => describeDateProblem(issue.input) }).nullable()
    case 'amount':
      return z.number({ error: (issue) => describeAmountProblem(issue.input) }).nullable()
    case 'text':
      return z.string().nullable()
  }
}

/** One object schema per file, built from the inferred column types. Empty cells (null) are allowed. */
export function buildRowSchema(columns: Column[]) {
  return z.object(Object.fromEntries(columns.map((column) => [column.key, fieldSchema(column.type)])))
}

export type RowSchema = ReturnType<typeof buildRowSchema>

/** Validates a normalised row and returns one error per failing field, in column order. */
export function validateRow(
  schema: RowSchema,
  columns: Column[],
  clean: Record<string, CleanValue>,
): FieldError[] {
  const parsed = schema.safeParse(clean)
  if (parsed.success) return []
  const byKey = new Map<string, string>()
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? '')
    if (!byKey.has(key)) byKey.set(key, issue.message)
  }
  return columns.flatMap((column) => {
    const message = byKey.get(column.key)
    return message ? [{ key: column.key, label: column.label || column.key, message }] : []
  })
}
