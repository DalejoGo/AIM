import type { Currency, QuoteConfig, ServiceId } from '@aim/contracts'
import { batch, computed, type ReadonlySignal, signal } from '@preact/signals'
import {
  buildMessage,
  buildQuoteSnapshot,
  defaultTimelineId,
  keepOwnOptions,
  type ServiceSummary,
  summarize,
} from './logic'

/** Cotizador state as signals. The currency is injected so this module runs without a DOM (and in tests). */
export function createQuoteState(
  config: QuoteConfig,
  services: readonly ServiceSummary[],
  currency: ReadonlySignal<Currency>,
) {
  const service = signal<ServiceId | null>(null)
  const options = signal<readonly string[]>([])
  const timeline = signal(defaultTimelineId(config))
  const name = signal('')
  const idea = signal('')

  const summary = computed(() =>
    summarize(
      config,
      services,
      { service: service.value, options: options.value, timeline: timeline.value },
      currency.value,
    ),
  )
  const message = computed(() =>
    summary.value ? buildMessage(summary.value, { name: name.value, idea: idea.value }) : '',
  )
  // What "Enviar mi solicitud" attaches to the lead: always the range on screen, in the current currency.
  const snapshot = computed(() => (summary.value ? buildQuoteSnapshot(summary.value) : null))

  return {
    service,
    options,
    timeline,
    name,
    idea,
    summary,
    message,
    snapshot,
    /** Changing the service drops the options that belong to the previous one. */
    selectService(id: ServiceId) {
      batch(() => {
        service.value = id
        options.value = keepOwnOptions(config, id, options.value)
      })
    },
    toggleOption(id: string, checked: boolean) {
      const next = checked ? [...options.value, id] : options.value.filter((o) => o !== id)
      options.value = keepOwnOptions(config, service.value, next)
    },
  }
}

export type QuoteState = ReturnType<typeof createQuoteState>
