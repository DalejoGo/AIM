import type { Currency, QuoteConfig, ServiceId } from '@aim/contracts'
import { signal, useSignal } from '@preact/signals'
import { CircleAlert } from 'lucide-preact'
import { useEffect, useMemo } from 'preact/hooks'
import { es } from '../../i18n/es'
import { currencySignal } from '../../lib/useCurrency'
import {
  availableServices,
  findService,
  optionsFor,
  parseServiceParam,
  SERVICE_PARAM,
  type ServiceSummary,
  surchargeLabel,
} from './logic'
import { choiceClass, inputClass, Money, Step } from './parts'
import { SummaryStep } from './SummaryStep'
import { createQuoteState } from './state'

export interface QuoteCalculatorProps {
  /** Ordered like the services page. */
  services: ServiceSummary[]
  config: QuoteConfig
  /** WhatsApp number in international format, digits only. */
  whatsapp: string
  turnstileSiteKey: string
}

// currencySignal() needs the DOM. The static render has no service chosen, so nothing priced by it shows yet.
const staticCurrency = signal<Currency>('COP')
const sharedCurrency = () => (typeof document === 'undefined' ? staticCurrency : currencySignal())

export default function QuoteCalculator({
  services,
  config,
  whatsapp,
  turnstileSiteKey,
}: QuoteCalculatorProps) {
  const listed = useMemo(() => availableServices(services, config), [services, config])
  const state = useMemo(() => createQuoteState(config, listed, sharedCurrency()), [config, listed])
  const unknownService = useSignal<string | null>(null)

  // Deep link (/cotizar/?servicio=web). Read after hydration because the page is static.
  useEffect(() => {
    const param = parseServiceParam(
      window.location.search,
      listed.map((s) => s.id),
    )
    if (param.kind === 'valid') state.selectService(param.service)
    if (param.kind === 'invalid') unknownService.value = param.value
  }, [listed, state, unknownService])

  function chooseService(id: ServiceId) {
    state.selectService(id)
    unknownService.value = null
    // Keep the address shareable: copying it reopens the cotizador on the same service.
    const url = new URL(window.location.href)
    url.searchParams.set(SERVICE_PARAM, id)
    window.history.replaceState(window.history.state, '', url)
  }

  const service = state.service.value
  const options = optionsFor(config, service)

  return (
    // The color scheme follows the site theme, not the OS, so native radios and checkboxes match the page.
    <div class="grid gap-12 [color-scheme:light] lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16 dark:[color-scheme:dark]">
      <div class="grid min-w-0 content-start gap-12">
        <Step number={1} title="Elige el servicio" id="quote-step-1">
          {unknownService.value !== null && (
            <p role="alert" class="mb-4 flex gap-2 text-danger">
              <CircleAlert size={18} class="mt-1 shrink-0" aria-hidden="true" />
              <span>
                No encontré el servicio «{unknownService.value}» del enlace. Elige uno de la lista para
                seguir.
              </span>
            </p>
          )}
          <div class="grid gap-3">
            {listed.map((s) => {
              const base = findService(config, s.id)?.base
              return (
                <label key={s.id} class={choiceClass}>
                  <input
                    type="radio"
                    name="quote-service"
                    value={s.id}
                    checked={service === s.id}
                    onChange={() => chooseService(s.id)}
                    class={inputClass}
                  />
                  <span class="grid min-w-0 flex-1 gap-1">
                    <span class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span class="text-step-1 font-semibold">{s.title}</span>
                      {base && (
                        <span class="text-step--1 tabular-nums">
                          <span class="text-muted">{es.price.from} </span>
                          <Money price={base} />
                        </span>
                      )}
                    </span>
                    <span class="text-muted">{s.tagline}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </Step>

        <Step
          number={2}
          title="Agrega funcionalidades"
          id="quote-step-2"
          hint="Son opcionales. Cada una se suma al precio base del servicio."
        >
          {service === null ? (
            <p class="rounded-xl border border-dashed border-line p-4 text-muted">
              Primero elige un servicio en el paso 1. Aquí verás lo que puedes sumarle.
            </p>
          ) : options.length === 0 ? (
            <p class="rounded-xl border border-dashed border-line p-4 text-muted">
              Este servicio no tiene funcionalidades adicionales. Sigue con el plazo.
            </p>
          ) : (
            <div class="grid gap-3">
              {options.map((o) => (
                <label key={`${service}-${o.id}`} class={choiceClass}>
                  <input
                    type="checkbox"
                    value={o.id}
                    checked={state.options.value.includes(o.id)}
                    onChange={(e) => state.toggleOption(o.id, e.currentTarget.checked)}
                    class={inputClass}
                  />
                  <span class="grid min-w-0 flex-1 gap-1">
                    <span class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span class="font-semibold">{o.label}</span>
                      <span class="text-step--1 tabular-nums">
                        + <Money price={o.price} />
                      </span>
                    </span>
                    <span class="text-step--1 text-muted">{o.description}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </Step>

        <Step
          number={3}
          title="Elige el plazo"
          id="quote-step-3"
          hint="Si lo necesitas antes, se aplica un recargo."
        >
          <div class="grid gap-3 sm:grid-cols-3">
            {config.timelines.map((t) => (
              <label key={t.id} class={choiceClass}>
                <input
                  type="radio"
                  name="quote-timeline"
                  value={t.id}
                  checked={state.timeline.value === t.id}
                  onChange={() => {
                    state.timeline.value = t.id
                  }}
                  class={inputClass}
                />
                <span class="grid min-w-0 gap-1">
                  <span class="font-semibold">{t.label}</span>
                  <span class="text-step--1 text-muted">{surchargeLabel(t.multiplier)}</span>
                </span>
              </label>
            ))}
          </div>
        </Step>
      </div>

      <SummaryStep
        state={state}
        whatsapp={whatsapp}
        turnstileSiteKey={turnstileSiteKey}
        class="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain"
      />
    </div>
  )
}
