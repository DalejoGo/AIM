import { type Signal, useSignal } from '@preact/signals'
import { CircleCheck, Send } from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'
import { ApiRequestError, api, messageForStatus } from '../../lib/api'
import {
  firstLeadError,
  type LeadErrors,
  type LeadField,
  leadServerProblem,
  validateLead,
} from '../../lib/lead'
import { FormAlert, focusSoon, Spinner } from '../forms/fields'
import { ConsentField, ReachFields } from '../forms/LeadFields'
import { Turnstile } from '../turnstile/Turnstile'
import { leadMessage } from './logic'
import type { QuoteState } from './state'

// Loaded only when the visitor opens "Enviar mi solicitud", so zod and Turnstile stay out of the cotizador.

export interface QuoteRequestProps {
  state: QuoteState
  turnstileSiteKey: string
  /** The name input lives above, shared with the WhatsApp message; its error is shown there. */
  nameId: string
  nameError: Signal<string | null>
}

const PREFIX = 'quote'
const CANNOT_BUILD = 'No pude preparar la solicitud con este cálculo. Recarga la página e inténtalo de nuevo.'

type Phase = 'editing' | 'sending' | 'sent'

export function QuoteRequest({ state, turnstileSiteKey, nameId, nameError }: QuoteRequestProps) {
  const email = useSignal('')
  const phone = useSignal('')
  const consent = useSignal(false)
  const errors = useSignal<LeadErrors>({})
  const formError = useSignal<string | null>(null)
  const phase = useSignal<Phase>('editing')
  const token = useSignal<string | null>(null)
  const resetKey = useSignal(0)
  const alertRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef<HTMLParagraphElement>(null)

  const fieldId = (field: LeadField) =>
    field === 'name' ? nameId : field === 'turnstileToken' ? `${PREFIX}-turnstile` : `${PREFIX}-${field}`

  useEffect(() => {
    if (phase.value === 'sent') doneRef.current?.focus()
  }, [phase.value])

  function clear(...fields: LeadField[]) {
    if (fields.some((f) => f in errors.value)) {
      errors.value = Object.fromEntries(
        Object.entries(errors.value).filter(([f]) => !fields.includes(f as LeadField)),
      )
    }
  }

  /** Shows errors where the visitor can fix them; service and message come from the cotizador itself. */
  function show(found: LeadErrors) {
    const { name, service, message, ...rest } = found
    nameError.value = name ?? null
    errors.value = rest
    if (service || message) formError.value = CANNOT_BUILD
    const first = firstLeadError(found)
    if (first && first !== 'service' && first !== 'message') focusSoon(fieldId(first))
    else alertRef.current?.focus()
  }

  async function submit(event: Event) {
    event.preventDefault()
    const summary = state.summary.value
    const snapshot = state.snapshot.value
    if (phase.value === 'sending' || !summary || !snapshot) return
    formError.value = null
    const contact = { name: state.name.value, idea: state.idea.value }
    const result = validateLead({
      name: state.name.value,
      email: email.value,
      phone: phone.value,
      service: summary.service.id,
      message: leadMessage(summary, contact),
      consent: consent.value,
      turnstileToken: token.value,
      quote: snapshot,
    })
    if (!result.ok) {
      show(result.errors)
      return
    }
    nameError.value = null
    errors.value = {}
    phase.value = 'sending'
    try {
      await api.submitLead(result.lead)
      phase.value = 'sent'
    } catch (error) {
      phase.value = 'editing'
      token.value = null
      resetKey.value += 1
      const problem =
        error instanceof ApiRequestError
          ? leadServerProblem(error)
          : { errors: {}, form: messageForStatus(0) }
      formError.value = problem.form
      show(problem.errors)
    }
  }

  if (phase.value === 'sent') {
    return (
      <div class="grid gap-2 rounded-xl border border-line p-4">
        <p ref={doneRef} tabIndex={-1} class="flex items-center gap-2 font-semibold">
          <CircleCheck size={20} class="shrink-0 text-live" aria-hidden="true" />
          Recibí tu solicitud
        </p>
        <p class="text-step--1">Me llegó con tu cálculo. Te respondo al correo o al teléfono que dejaste.</p>
      </div>
    )
  }

  const e = errors.value
  const sending = phase.value === 'sending'
  return (
    <form
      noValidate
      onSubmit={submit}
      aria-labelledby="quote-request-title"
      class="grid gap-5 rounded-xl border border-line p-4"
    >
      <div class="grid gap-1">
        <h3 id="quote-request-title" class="text-step-0 font-semibold">
          Enviar mi solicitud
        </h3>
        <p class="text-step--1 text-muted">
          Me llega con este cálculo, tu nombre y tu idea. Solo falta cómo responderte.
        </p>
      </div>

      <ReachFields
        prefix={PREFIX}
        email={email.value}
        phone={phone.value}
        errors={e}
        onEmail={(value) => {
          email.value = value
          clear('email', 'phone')
        }}
        onPhone={(value) => {
          phone.value = value
          clear('email', 'phone')
        }}
      />

      <ConsentField
        prefix={PREFIX}
        checked={consent.value}
        error={e.consent}
        onChange={(checked) => {
          consent.value = checked
          clear('consent')
        }}
      />

      <Turnstile
        id={fieldId('turnstileToken')}
        siteKey={turnstileSiteKey}
        action="quote"
        onToken={(next) => {
          token.value = next
          if (next) clear('turnstileToken')
        }}
        resetKey={resetKey.value}
        error={e.turnstileToken}
      />

      <div class="grid gap-3">
        <FormAlert message={formError.value} alertRef={alertRef}>
          <p>Si el problema sigue, usa «Enviar por WhatsApp»: lleva el mismo resumen.</p>
        </FormAlert>
        <button
          type="submit"
          class="btn btn-primary aria-disabled:cursor-wait aria-disabled:opacity-80"
          aria-disabled={sending}
        >
          {sending ? <Spinner /> : <Send size={18} aria-hidden="true" />}
          {sending ? 'Enviando…' : 'Enviar solicitud'}
        </button>
        <p role="status" class="sr-only">
          {sending ? 'Enviando tu solicitud.' : ''}
        </p>
      </div>
    </form>
  )
}
