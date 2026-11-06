import type { Currency } from '@aim/contracts'
import { signal } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import { quote } from '../../lib/site'
import type { ServiceSummary } from './logic'
import { createQuoteState } from './state'

const services: ServiceSummary[] = quote.services.map((s) => ({
  id: s.service,
  title: s.service,
  tagline: '-',
}))

function setup(initial: Currency = 'COP') {
  const currency = signal<Currency>(initial)
  return { currency, state: createQuoteState(quote, services, currency) }
}

const firstOption = (index: number) => {
  const option = quote.services[index]?.options[0]
  if (!option) throw new Error('quote.json needs options for this test')
  return option.id
}

describe('createQuoteState', () => {
  it('starts empty on the default timeline', () => {
    const { state } = setup()
    expect(state.service.value).toBeNull()
    expect(state.timeline.value).toBe(quote.timelines[0]?.id)
    expect(state.summary.value).toBeNull()
    expect(state.message.value).toBe('')
  })

  it('drops the options of the previous service when the service changes', () => {
    const { state } = setup()
    const [first, second] = quote.services
    if (!first || !second) throw new Error('quote.json needs two services for this test')
    state.selectService(first.service)
    state.toggleOption(firstOption(0), true)
    expect(state.options.value).toEqual([firstOption(0)])
    state.selectService(second.service)
    expect(state.options.value).toEqual([])
  })

  it('adds and removes options, ignoring those of other services', () => {
    const { state } = setup()
    const first = quote.services[0]
    if (!first) throw new Error('quote.json needs a service for this test')
    state.selectService(first.service)
    state.toggleOption(firstOption(1), true)
    expect(state.options.value).toEqual([])
    state.toggleOption(firstOption(0), true)
    state.toggleOption(firstOption(0), false)
    expect(state.options.value).toEqual([])
  })

  it('follows the currency signal and the contact fields', () => {
    const { currency, state } = setup('COP')
    const first = quote.services[0]
    if (!first) throw new Error('quote.json needs a service for this test')
    state.selectService(first.service)
    expect(state.summary.value?.estimate.currency).toBe('COP')
    currency.value = 'USD'
    expect(state.summary.value?.estimate.currency).toBe('USD')
    expect(state.message.value).toContain('US$')
    state.name.value = 'Ana'
    state.idea.value = 'Algo sencillo.'
    expect(state.message.value).toContain('Hola, soy Ana.')
    expect(state.message.value).toContain('Mi idea: Algo sencillo.')
  })
})
