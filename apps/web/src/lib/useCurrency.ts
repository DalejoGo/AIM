import type { Currency } from '@aim/contracts'
import { type Signal, signal } from '@preact/signals'
import { getCurrency, onCurrencyChange } from './preferences'

let shared: Signal<Currency> | undefined

/** A signal with the visitor's currency, kept in sync with the header switch. Islands only (needs the DOM). */
export function currencySignal() {
  if (!shared) {
    shared = signal<Currency>(getCurrency())
    onCurrencyChange((currency) => {
      if (shared) shared.value = currency
    })
  }
  return shared
}
