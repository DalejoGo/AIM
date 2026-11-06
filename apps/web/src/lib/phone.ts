/** Country code assumed when a number comes without one (DEC-010: most visitors write from Colombia). */
export const DEFAULT_COUNTRY_CODE = '57'

/** A Colombian mobile number without its country code: ten digits starting with 3. */
const LOCAL_MOBILE = /^3\d{9}$/

/**
 * Turns a phone typed in any format ("+57 300 123 4567", "(300) 123-4567", "0057…") into the digits-only
 * international form CreateLead expects (573001234567).
 * - "+" or "00" in front: the digits after it are already international.
 * - Ten digits starting with 3: a Colombian mobile, so 57 is added.
 * - Anything else: the digits as typed (the visitor wrote the country code without "+").
 * Returns undefined for an empty field; an invalid number comes back as digits and fails validation.
 */
export function normalizePhone(raw: string): string | undefined {
  const value = raw.trim()
  if (!value) return undefined
  const digits = value.replace(/\D/g, '')
  if (value.startsWith('+')) return digits
  if (value.startsWith('00')) return digits.slice(2)
  if (LOCAL_MOBILE.test(digits)) return `${DEFAULT_COUNTRY_CODE}${digits}`
  return digits
}
