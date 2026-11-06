/**
 * Value normalisers. Each one is best effort: when a value cannot be converted it comes back cleaned but
 * otherwise untouched, and validation (validate.ts) explains what is wrong with it.
 */

const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff]/g

/** Removes invisible characters, collapses runs of whitespace and trims. */
export function cleanText(value: string): string {
  return value.replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim()
}

/** Strips accents and diacritics: "Teléfono" becomes "Telefono". */
export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Turns a header into a snake_case key: " Correo Electrónico " becomes "correo_electronico". */
export function normalizeHeader(label: string, index: number): string {
  const key = stripAccents(cleanText(label))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return key || `columna_${index + 1}`
}

/** Makes keys unique by numbering repeats: ["a", "a"] becomes ["a", "a_2"]. */
export function uniqueKeys(keys: string[]): string[] {
  const seen = new Set<string>()
  return keys.map((key) => {
    let candidate = key
    for (let n = 2; seen.has(candidate); n++) candidate = `${key}_${n}`
    seen.add(candidate)
    return candidate
  })
}

/** Words kept in lower case inside names, as Spanish writes them ("María de los Ángeles"). */
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e'])
const INITIALS = /^(?:\p{L}\.)+\p{L}?$/u

/** Title case for names and places: "  ana maría  DE LA cruz " becomes "Ana María de la Cruz". */
export function toTitleCase(value: string): string {
  return cleanText(value)
    .toLocaleLowerCase('es')
    .split(' ')
    .map((word, i) => {
      if (i > 0 && PARTICLES.has(word)) return word
      if (INITIALS.test(word)) return word.toLocaleUpperCase('es')
      return word.replace(
        /(^|[-'’])(\p{L})/gu,
        (_, sep: string, letter: string) => sep + letter.toLocaleUpperCase('es'),
      )
    })
    .join(' ')
}

/** Lower case, no stray spaces around "@" or ".", no "mailto:". Inner spaces stay so validation flags them. */
export function normalizeEmail(value: string): string {
  return cleanText(value)
    .replace(/^mailto:/i, '')
    .replace(/\s*([@.])\s*/g, '$1')
    .toLowerCase()
}

/** Country assumed for numbers written without one: Colombian mobiles have 10 digits and start with 3. */
export const DEFAULT_COUNTRY_CODE = '57'

/** E.164: "+" and 8 to 15 digits; Colombian numbers (+57) carry exactly 10 digits after the code. */
export const E164 = new RegExp(
  `^(?:\\+${DEFAULT_COUNTRY_CODE}\\d{10}|\\+(?!${DEFAULT_COUNTRY_CODE})[1-9]\\d{7,14})$`,
)

const PHONE_CHARS = /^[+\d\s().\-/]+$/

function toE164(text: string): string | null {
  const digits = text.replace(/\D/g, '')
  if (/^\(?\+/.test(text)) return `+${digits}`
  if (digits.startsWith('00')) return `+${digits.slice(2)}`
  if (digits.length === 10 && digits.startsWith('3')) return `+${DEFAULT_COUNTRY_CODE}${digits}`
  if (digits.length === 12 && digits.startsWith(`${DEFAULT_COUNTRY_CODE}3`)) return `+${digits}`
  return null
}

/**
 * Phone to E.164 ("+573005550101"). Numbers written with "+" or "00" keep their country code; 10 digits that
 * start with 3 are taken as Colombian mobiles (+57). Anything that does not end up as a valid E.164 number is
 * returned cleaned, as the person wrote it, so the validation message quotes their value.
 */
export function normalizePhone(value: string): string {
  const text = cleanText(value)
  if (!PHONE_CHARS.test(text)) return text
  const e164 = toE164(text)
  return e164 && E164.test(e164) ? e164 : text
}

const MONTHS = new Map<string, number>(
  Object.entries({
    enero: 1,
    ene: 1,
    febrero: 2,
    feb: 2,
    marzo: 3,
    mar: 3,
    abril: 4,
    abr: 4,
    mayo: 5,
    may: 5,
    junio: 6,
    jun: 6,
    julio: 7,
    jul: 7,
    agosto: 8,
    ago: 8,
    septiembre: 9,
    setiembre: 9,
    sept: 9,
    sep: 9,
    set: 9,
    octubre: 10,
    oct: 10,
    noviembre: 11,
    nov: 11,
    diciembre: 12,
    dic: 12,
  }),
)

export const MIN_YEAR = 1900
export const MAX_YEAR = 2100

const TIME_SUFFIX = /(?:T|\s+)\d{1,2}:\d{2}.*$/i
const WEEKDAY_PREFIX = /^(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo),?\s+/
const ISO_LIKE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/
const DAY_FIRST = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Two-digit years: 00 to 49 are 2000s, 50 to 99 are 1900s. */
export function expandYear(year: string): number {
  const n = Number(year)
  if (year.length !== 2) return n
  return n < 50 ? 2000 + n : 1900 + n
}

function toIso(year: number, month: number, day: number): string | null {
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Splits a date into year, month and day, reading numeric dates day first. Does not check the calendar. */
export function dateParts(value: string): { year: number; month: number; day: number } | null {
  const text = stripAccents(cleanText(value).toLowerCase())
    .replace(TIME_SUFFIX, '')
    .replace(WEEKDAY_PREFIX, '')

  const iso = ISO_LIKE.exec(text)
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }

  const dayFirst = DAY_FIRST.exec(text)
  if (dayFirst) {
    return { year: expandYear(dayFirst[3] ?? ''), month: Number(dayFirst[2]), day: Number(dayFirst[1]) }
  }

  // Written months: "3 de abril de 2024", "3-abr-2024", "abril 3, 2024".
  const words = text
    .replace(/,/g, ' ')
    .replace(/\b(?:de|del)\b/g, ' ')
    .split(/[\s/-]+/)
    .filter(Boolean)
    .map((word) => word.replace(/\.$/, ''))
  if (words.length !== 3) return null
  const [a = '', b = '', c = ''] = words
  if (!/^\d{2}(?:\d{2})?$/.test(c)) return null
  const monthAfterDay = MONTHS.get(b)
  if (/^\d{1,2}$/.test(a) && monthAfterDay)
    return { year: expandYear(c), month: monthAfterDay, day: Number(a) }
  const monthBeforeDay = MONTHS.get(a)
  if (monthBeforeDay && /^\d{1,2}$/.test(b))
    return { year: expandYear(c), month: monthBeforeDay, day: Number(b) }
  return null
}

/** Date to ISO "YYYY-MM-DD", or null when it is not a real date between 1900 and 2100. */
export function parseDate(value: string): string | null {
  const parts = dateParts(value)
  return parts ? toIso(parts.year, parts.month, parts.day) : null
}

export function normalizeDate(value: string): string {
  const text = cleanText(value)
  return parseDate(text) ?? text
}

const CURRENCY = /us\$|\$|€|\b(?:cop|usd|eur|pesos?)\b/gi

/**
 * Amount to a number. Accepts "$1.200.000,50", "1,200,000.50" and "1200000.5". With both separators the last
 * one is the decimal mark. With only one, repeated means thousands, and a single one followed by exactly
 * three digits ("850.000") is read as thousands too, as Latin American files usually write it.
 */
export function parseAmount(value: string): number | null {
  let text = cleanText(value)
  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }
  text = text.replace(CURRENCY, '').trim()
  const sign = /^([-+])\s*/.exec(text)
  if (sign) {
    negative = negative !== (sign[1] === '-')
    text = text.slice(sign[0].length)
  }
  if (!/^\d[\d.,]*$/.test(text)) return null

  const lastDot = text.lastIndexOf('.')
  const lastComma = text.lastIndexOf(',')
  let decimalMark: '.' | ',' | null = null
  if (lastDot >= 0 && lastComma >= 0) {
    decimalMark = lastDot > lastComma ? '.' : ','
  } else if (lastDot >= 0 || lastComma >= 0) {
    const mark = lastDot >= 0 ? '.' : ','
    const at = text.indexOf(mark)
    const single = at === text.lastIndexOf(mark)
    const head = text.slice(0, at)
    const looksLikeThousands = text.length - at - 1 === 3 && head.length <= 3 && head !== '0'
    if (single && !looksLikeThousands) decimalMark = mark
  }

  const [integerPart = '', decimals, extra] = decimalMark ? text.split(decimalMark) : [text]
  if (extra !== undefined || decimals === '' || (decimals !== undefined && !/^\d+$/.test(decimals)))
    return null
  const groups = integerPart.split(/[.,]/)
  if (groups.length > 1) {
    const separators = new Set(integerPart.replace(/\d/g, ''))
    if (separators.size > 1) return null
    const [first = '', ...rest] = groups
    if (!/^\d{1,3}$/.test(first) || rest.some((group) => !/^\d{3}$/.test(group))) return null
  }

  const amount = Number(`${groups.join('')}${decimals ? `.${decimals}` : ''}`)
  if (!Number.isFinite(amount)) return null
  return negative ? -amount : amount
}

export function normalizeAmount(value: string): number | string {
  return parseAmount(value) ?? cleanText(value)
}
