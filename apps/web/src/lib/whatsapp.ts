const DIGITS = /^\d{8,15}$/

/** Builds a wa.me link, optionally with a prefilled message. */
export function whatsappLink(number: string, message?: string): string {
  if (!DIGITS.test(number)) throw new Error('WhatsApp number must be 8-15 digits in international format')
  const url = new URL(`https://wa.me/${number}`)
  if (message?.trim()) url.searchParams.set('text', message.trim())
  return url.href
}
