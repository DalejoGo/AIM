import { useSignal } from '@preact/signals'
import { Check, ChevronDown, CircleAlert, Copy, Info, MessageCircle } from 'lucide-preact'
import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { formatMoney } from '../../lib/money'
import { whatsappLink } from '../../lib/whatsapp'
import { FieldError } from '../forms/fields'
import { currencyName, surchargeLabel } from './logic'
import { StepHeading } from './parts'
import type { QuoteRequestProps } from './QuoteRequest'
import type { QuoteState } from './state'

interface SummaryStepProps {
  state: QuoteState
  whatsapp: string
  /** Turnstile site key for "Enviar mi solicitud". */
  turnstileSiteKey: string
  class?: string
}

type RequestForm = (props: QuoteRequestProps) => JSX.Element

// The request form brings zod, the API client and Turnstile: it loads on first use (or when the button is hovered).
let requestForm: Promise<RequestForm> | null = null
function loadRequestForm(): Promise<RequestForm> {
  requestForm ??= import('./QuoteRequest')
    .then((m) => m.QuoteRequest)
    .catch((error: unknown) => {
      requestForm = null
      throw error
    })
  return requestForm
}

const NAME_ID = 'quote-name'

type CopyStatus = 'idle' | 'copied' | 'failed'

const fieldClass =
  'w-full rounded-lg border border-line bg-ink px-3 py-2.5 text-text placeholder:text-muted hover:border-brand'

export function SummaryStep({ state, whatsapp, turnstileSiteKey, class: className = '' }: SummaryStepProps) {
  const summary = state.summary.value
  const copyStatus = useSignal<CopyStatus>('idle')
  const requestOpen = useSignal(false)
  const requestFailed = useSignal(false)
  const nameError = useSignal<string | null>(null)
  const [Request, setRequest] = useState<RequestForm | null>(null)
  const preview = useRef<HTMLDetailsElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current)
  }

  useEffect(() => stopTimer, [])

  async function copy() {
    stopTimer()
    try {
      await navigator.clipboard.writeText(state.message.value)
      copyStatus.value = 'copied'
      timer.current = setTimeout(() => {
        copyStatus.value = 'idle'
      }, 4000)
    } catch {
      // No clipboard API (insecure context) or permission denied: the full text is one click away.
      copyStatus.value = 'failed'
      if (preview.current) preview.current.open = true
    }
  }

  function preloadRequest() {
    loadRequestForm().catch(() => {
      // Retried when the visitor opens the form.
    })
  }

  function toggleRequest() {
    requestOpen.value = !requestOpen.value
    if (!requestOpen.value) {
      nameError.value = null
      return
    }
    requestFailed.value = false
    loadRequestForm()
      .then((form) => setRequest(() => form))
      .catch(() => {
        requestFailed.value = true
      })
  }

  const nameRequired = requestOpen.value

  return (
    <section
      aria-labelledby="quote-step-4-title"
      class={`grid min-w-0 content-start gap-6 rounded-2xl border border-line bg-raised p-5 sm:p-6 ${className}`}
    >
      <StepHeading number={4} title="Revisa tu presupuesto" id="quote-step-4-title" />

      <div aria-live="polite" aria-atomic="true">
        {summary ? (
          <>
            <p class="text-step--1 text-muted">Rango estimado</p>
            <p class="mt-1 font-display text-step-2 font-semibold leading-tight">
              <span class="whitespace-nowrap">
                {formatMoney(summary.estimate.low, summary.estimate.currency)}
              </span>
              {summary.estimate.high !== summary.estimate.low && (
                <>
                  {' '}
                  <span class="font-sans text-step-0 font-normal text-muted">a</span>{' '}
                  <span class="whitespace-nowrap">
                    {formatMoney(summary.estimate.high, summary.estimate.currency)}
                  </span>
                </>
              )}
            </p>
          </>
        ) : (
          <p class="text-muted">Elige un servicio en el paso 1 y aquí verás el rango estimado.</p>
        )}
      </div>

      {summary && (
        <p class="-mt-3 text-step--1 text-muted">
          En {currencyName(summary.estimate.currency)}. Puedes cambiar la moneda en el selector COP/USD de la
          parte superior.
        </p>
      )}

      <p class="flex gap-2 rounded-lg border border-line p-3 text-step--1">
        <Info size={18} class="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
        <span>
          Este rango es una referencia. El valor final queda en la propuesta escrita, después de revisar tu
          proyecto contigo.
        </span>
      </p>

      {summary && (
        <dl class="grid gap-3 text-step--1">
          <div>
            <dt class="text-muted">Servicio</dt>
            <dd class="font-semibold">{summary.service.title}</dd>
          </div>
          <div>
            <dt class="text-muted">Funcionalidades</dt>
            <dd>
              {summary.options.length > 0 ? (
                <ul class="list-disc pl-5">
                  {summary.options.map((o) => (
                    <li key={o.id}>{o.label}</li>
                  ))}
                </ul>
              ) : (
                'Ninguna adicional'
              )}
            </dd>
          </div>
          <div>
            <dt class="text-muted">Plazo</dt>
            <dd>
              {summary.timeline.label} ({surchargeLabel(summary.timeline.multiplier).toLowerCase()})
            </dd>
          </div>
        </dl>
      )}

      <div class="grid gap-4">
        <div class="grid gap-1.5">
          <label for={NAME_ID} class="text-step--1 font-semibold">
            Tu nombre {!nameRequired && <span class="font-normal text-muted">(opcional)</span>}
          </label>
          <input
            id={NAME_ID}
            type="text"
            autocomplete="name"
            maxLength={80}
            value={state.name.value}
            aria-invalid={nameError.value ? true : undefined}
            aria-describedby={nameError.value ? `${NAME_ID}-error` : undefined}
            onInput={(e) => {
              state.name.value = e.currentTarget.value
              nameError.value = null
            }}
            class={`${fieldClass} aria-[invalid=true]:border-danger`}
          />
          {nameError.value && <FieldError id={`${NAME_ID}-error`}>{nameError.value}</FieldError>}
        </div>
        <div class="grid gap-1.5">
          <label for="quote-idea" class="text-step--1 font-semibold">
            Cuéntame tu idea <span class="font-normal text-muted">(opcional)</span>
          </label>
          <textarea
            id="quote-idea"
            rows={4}
            maxLength={1000}
            placeholder="Qué quieres lograr, para quién es, si ya tienes algo hecho…"
            value={state.idea.value}
            onInput={(e) => {
              state.idea.value = e.currentTarget.value
            }}
            class={`${fieldClass} resize-y`}
          />
        </div>
      </div>

      {summary && (
        <div class="grid gap-3">
          <div class="flex flex-wrap gap-3">
            <a
              href={whatsappLink(whatsapp, state.message.value)}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-primary grow"
            >
              <MessageCircle size={18} aria-hidden="true" />
              Enviar por WhatsApp
              <span class="sr-only"> (se abre en otra pestaña)</span>
            </a>
            <button type="button" onClick={copy} class="btn btn-quiet grow">
              {copyStatus.value === 'copied' ? (
                <Check size={18} aria-hidden="true" />
              ) : (
                <Copy size={18} aria-hidden="true" />
              )}
              Copiar resumen
            </button>
            <button
              type="button"
              aria-expanded={requestOpen.value}
              aria-controls="quote-request"
              onClick={toggleRequest}
              onPointerEnter={preloadRequest}
              onFocus={preloadRequest}
              class="btn btn-quiet grow"
            >
              Enviar mi solicitud
              <ChevronDown
                size={18}
                aria-hidden="true"
                class={`transition-transform ${requestOpen.value ? 'rotate-180' : ''}`}
              />
            </button>
          </div>

          <p role="status" class="text-step--1">
            {copyStatus.value === 'copied' && (
              <span class="flex items-center gap-2 text-live">
                <Check size={16} aria-hidden="true" />
                Resumen copiado
              </span>
            )}
            {copyStatus.value === 'failed' && (
              <span class="flex gap-2 text-danger">
                <CircleAlert size={16} class="mt-1 shrink-0" aria-hidden="true" />
                Tu navegador no dejó copiar el resumen. Ábrelo abajo, en «Ver el mensaje completo», y cópialo
                a mano.
              </span>
            )}
          </p>

          <details ref={preview} class="text-step--1">
            <summary class="cursor-pointer text-muted hover:text-text">Ver el mensaje completo</summary>
            <p class="mt-2 whitespace-pre-wrap rounded-lg bg-ink p-3">{state.message.value}</p>
          </details>

          <div id="quote-request" hidden={!requestOpen.value}>
            {requestOpen.value &&
              (Request ? (
                <Request
                  state={state}
                  turnstileSiteKey={turnstileSiteKey}
                  nameId={NAME_ID}
                  nameError={nameError}
                />
              ) : requestFailed.value ? (
                <p role="alert" class="flex gap-2 text-step--1 text-danger">
                  <CircleAlert size={16} class="mt-1 shrink-0" aria-hidden="true" />
                  <span>
                    El formulario no cargó. Revisa tu conexión y vuelve a tocar «Enviar mi solicitud», o usa
                    «Enviar por WhatsApp».
                  </span>
                </p>
              ) : (
                <p role="status" class="text-step--1 text-muted">
                  Cargando el formulario…
                </p>
              ))}
          </div>
        </div>
      )}
    </section>
  )
}
