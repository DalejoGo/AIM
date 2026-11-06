import { describe, expect, it } from 'vitest'
import { formatMoney, priceIn } from './money'

// Intl uses non-breaking spaces; normalise them so the assertions stay readable.
const plain = (s: string) => s.replace(/\s/g, ' ')

describe('formatMoney', () => {
  it('formats pesos without decimals', () => {
    expect(plain(formatMoney(900000, 'COP'))).toBe('$ 900.000')
  })

  it('formats dollars with their symbol', () => {
    expect(plain(formatMoney(250, 'USD'))).toBe('US$ 250')
  })
})

describe('priceIn', () => {
  it('picks the amount for a currency', () => {
    expect(priceIn({ COP: 900000, USD: 250 }, 'USD')).toBe(250)
  })
})
