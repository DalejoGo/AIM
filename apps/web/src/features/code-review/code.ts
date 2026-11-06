/**
 * What the browser sends to POST /api/assistant/review, checked before it leaves: the languages and the limit
 * come from @aim/contracts (CodeReviewRequest), without zod.
 */

import type { CodeReviewLanguage } from '@aim/contracts'
import { CODE_REVIEW_LANGUAGES, CODE_REVIEW_MAX_LENGTH } from '@aim/contracts/limits'

export type Language = CodeReviewLanguage

export const MAX_CODE_LENGTH = CODE_REVIEW_MAX_LENGTH

const LABELS: Record<Language, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  sql: 'SQL',
  otro: 'Otro lenguaje',
}

/** The options of the language selector, in the order of the contract. */
export const LANGUAGES: readonly { value: Language; label: string }[] = CODE_REVIEW_LANGUAGES.map(
  (value) => ({
    value,
    label: LABELS[value],
  }),
)

export const isLanguage = (value: string): value is Language =>
  (CODE_REVIEW_LANGUAGES as readonly string[]).includes(value)

// \p{Cc} = control characters. Line breaks and tabs stay, as the API keeps them.
const CONTROL_BUT_LINE_BREAKS = /[^\P{Cc}\n\t]/gu
const LEADING_BLANK_LINES = /^(?:[ \t]*\n)+/

/** The code the API will review: CRLF as LF, no control characters, no blank lines around it; indentation stays. */
export function normalizeCode(code: string): string {
  return code
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_BUT_LINE_BREAKS, '')
    .replace(LEADING_BLANK_LINES, '')
    .trimEnd()
}

/** Why the fragment cannot be sent as it is, or null when it can. Same rules and words as the API. */
export function codeError(code: string): string | null {
  const clean = normalizeCode(code)
  if (!clean) return 'Pega el código que quieres revisar.'
  if (clean.length > MAX_CODE_LENGTH) {
    return `El código puede tener hasta ${MAX_CODE_LENGTH} caracteres. Pega solo la parte que quieres revisar.`
  }
  return null
}
