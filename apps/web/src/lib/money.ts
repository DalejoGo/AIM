import type { Currency, Price } from '@aim/contracts'

const formatters = new Map<Currency, Intl.NumberFormat>()

/** Formats a whole amount in the given currency for Spanish-speaking readers (e.g. "$ 900.000", "US$ 250"). */
export function formatMoney(amount: number, currency: Currency): string {
  let formatter = formatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 })
    formatters.set(currency, formatter)
  }
  return formatter.format(amount)
}

/** Picks the amount of a price in one currency. */
export function priceIn(price: Price, currency: Currency): number {
  return price[currency]
}
