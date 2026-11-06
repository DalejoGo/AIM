import { useSignal } from '@preact/signals'
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
import { a11yProps, Field, FormAlert, focusSoon, inputClass, Spinner } from '../forms/fields'
import { ConsentField, ReachFields } from '../forms/LeadFields'
import { Turnstile } from '../turnstile/Turnstile'

export interface ContactFormProps {
  /** Services in page order, then "Otro". */
  services: { id: string; title: string }[]
  turnstileSiteKey: string
  /** wa.me link: the alternative stays one tap away whatever happens to the form. */
  whatsappUrl: string
}

interface Values {
  name: string
  email: string
  phone: string
  service: string
  message: string
  consent: boolean
}

const EMPTY: Values = { name: '', email: '', phone: '', service: '', message: '', consent: false }
const PREFIX = 'contact'
const fieldId = (field: LeadField) =>
  field === 'turnstileToken' ? `${PREFIX}-turnstile` : `${PREFIX}-${field}`

type Phase = 'editing' | 'sending' | 'sent'

export default function ContactForm({ services, turnstileSiteKey, whatsappUrl }: ContactFormProps) {
  const values = useSignal<Values>(EMPTY)
  const errors = useSignal<LeadErrors>({})
  const formError = useSignal<string | null>(null)
  const phase = useSignal<Phase>('editing')
  const token = useSignal<string | null>(null)
  const resetKey = useSignal(0)
  const alertRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (phase.value === 'sent') doneRef.current?.focus()
  }, [phase.value])

  function update<K extends keyof Values>(field: K, value: Values[K]) {
    values.value = { ...values.value, [field]: value }
    // Editing a field clears its error; e-mail and phone answer the same question, so they clear together.
    const cleared = field === 'email' || field === 'phone' ? ['email', 'phone'] : [field]
    if (cleared.some((f) => f in errors.value)) {
      errors.value = Object.fromEntries(Object.entries(errors.value).filter(([f]) => !cleared.includes(f)))
    }
  }

  function onToken(next: string | null) {
    token.value = next
    if (next && errors.value.turnstileToken) {
      const { turnstileToken: _, ...rest } = errors.value
      errors.value = rest
    }
  }

  async function submit(event: Event) {
    event.preventDefault()
    if (phase.value === 'sending') return
    formError.value = null
    const result = validateLead({ ...values.value, turnstileToken: token.value })
    if (!result.ok) {
      errors.value = result.errors
      const first = firstLeadError(result.errors)
      if (first) focusSoon(fieldId(first))
      return
    }
    errors.value = {}
    phase.value = 'sending'
    try {
      await api.submitLead(result.lead)
      phase.value = 'sent'
    } catch (error) {
      phase.value = 'editing'
      // The token was spent on this request; the widget gets a new one.
      token.value = null
      resetKey.value += 1
      const problem =
        error instanceof ApiRequestError
          ? leadServerProblem(error)
          : { errors: {}, form: messageForStatus(0) }
      errors.value = problem.errors
      formError.value = problem.form
      const first = firstLeadError(problem.errors)
      if (first) focusSoon(fieldId(first))
      else alertRef.current?.focus()
    }
  }

  function writeAgain() {
    // Same person, new message: the contact data stays and the consent is asked again.
    values.value = { ...values.value, message: '', consent: false }
    token.value = null
    resetKey.value = 0
    phase.value = 'editing'
    focusSoon(fieldId('message'))
  }

  const whatsappLine = (
    <p class="text-step--1 text-muted">
      ¿Prefieres hablar ya?{' '}
      <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" class="link font-semibold">
        Escribir por WhatsApp
        <span class="sr-only"> (se abre en otra pestaña)</span>
      </a>
    </p>
  )

  if (phase.value === 'sent') {
    return (
      <div class="grid gap-4 rounded-2xl border border-line bg-raised p-5 sm:p-8">
        <CircleCheck size={32} class="text-live" aria-hidden="true" />
        <h2 ref={doneRef} tabIndex={-1} class="text-step-2 font-semibold">
          Recibí tu mensaje
        </h2>
        <p class="prose-measure">
          Gracias por escribir. Lo leo con calma y te respondo al correo o al teléfono que dejaste.
        </p>
        <div>
          <button type="button" class="btn btn-quiet" onClick={writeAgain}>
            Escribir otro mensaje
          </button>
        </div>
        {whatsappLine}
      </div>
    )
  }

  const v = values.value
  const e = errors.value
  const sending = phase.value === 'sending'
  const messageHint = 'Qué quieres lograr, para quién es y si ya tienes algo hecho. Mínimo 10 caracteres.'

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-label="Formulario de contacto"
      class="grid min-w-0 gap-6 rounded-2xl border border-line bg-raised p-5 sm:p-8"
    >
      <Field id={fieldId('name')} label="Tu nombre" error={e.name}>
        <input
          {...a11yProps(fieldId('name'), { error: e.name })}
          type="text"
          autocomplete="name"
          maxLength={80}
          value={v.name}
          onInput={(ev) => update('name', ev.currentTarget.value)}
          class={inputClass}
        />
      </Field>

      <ReachFields
        prefix={PREFIX}
        email={v.email}
        phone={v.phone}
        errors={e}
        onEmail={(value) => update('email', value)}
        onPhone={(value) => update('phone', value)}
      />

      <Field id={fieldId('service')} label="¿Qué necesitas?" error={e.service}>
        <select
          {...a11yProps(fieldId('service'), { error: e.service })}
          value={v.service}
          onChange={(ev) => update('service', ev.currentTarget.value)}
          class={inputClass}
        >
          <option value="" disabled>
            Elige una opción
          </option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </Field>

      <Field id={fieldId('message')} label="Cuéntame tu proyecto" hint={messageHint} error={e.message}>
        <textarea
          {...a11yProps(fieldId('message'), { hint: messageHint, error: e.message })}
          rows={6}
          maxLength={2000}
          value={v.message}
          onInput={(ev) => update('message', ev.currentTarget.value)}
          class={`${inputClass} resize-y`}
        />
      </Field>

      <ConsentField
        prefix={PREFIX}
        checked={v.consent}
        error={e.consent}
        onChange={(checked) => update('consent', checked)}
      />

      <Turnstile
        id={fieldId('turnstileToken')}
        siteKey={turnstileSiteKey}
        action="contact"
        onToken={onToken}
        resetKey={resetKey.value}
        error={e.turnstileToken}
      />

      <div class="grid gap-3">
        <FormAlert message={formError.value} alertRef={alertRef}>
          <p>
            Si el problema sigue,{' '}
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" class="link">
              escríbeme por WhatsApp
              <span class="sr-only"> (se abre en otra pestaña)</span>
            </a>
            .
          </p>
        </FormAlert>
        <div>
          <button
            type="submit"
            class="btn btn-primary w-full aria-disabled:cursor-wait aria-disabled:opacity-80 sm:w-auto"
            aria-disabled={sending}
          >
            {sending ? <Spinner /> : <Send size={18} aria-hidden="true" />}
            {sending ? 'Enviando…' : 'Enviar mensaje'}
          </button>
        </div>
        <p role="status" class="sr-only">
          {sending ? 'Enviando tu mensaje.' : ''}
        </p>
        {whatsappLine}
      </div>
    </form>
  )
}
