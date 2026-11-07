import { useSignal } from '@preact/signals'
import { CircleAlert, FlaskConical, Info, Play, Square } from 'lucide-preact'
import { useEffect, useMemo, useRef } from 'preact/hooks'
import { a11yProps, Field, focusSoon, inputClass, Spinner } from '../forms/fields'
import { Turnstile } from '../turnstile/Turnstile'
import type { Problem } from './errors'
import {
  BUDGETS,
  EMPTY_FORM,
  FIELD_ORDER,
  fieldsFromApi,
  isBudget,
  isTimeline,
  type LeadErrors,
  type LeadField,
  type LeadForm,
  LIMITS,
  leadErrors,
  SAMPLE_LEADS,
  type ServiceOption,
  TIMELINES,
  toLead,
} from './lead'
import { RunPanel } from './RunPanel'
import { createAutomationRun, type StartRun } from './run'

export interface AutomationDemoProps {
  /** The services of src/content/services, in their order: the lead's "service" options. */
  services: ServiceOption[]
  turnstileSiteKey: string
  whatsappUrl: string
  /** The flow's JSON in the repository (automations/workflows/lead-demo.json). */
  workflowUrl: string
}

const ID = 'automation'
const fieldId = (field: LeadField) => `${ID}-${field}`
const TURNSTILE_ID = `${ID}-turnstile`
const LOAD_FAILED: Problem = {
  kind: 'server',
  message: 'No se pudo cargar esta parte de la demo. Recarga la página e inténtalo de nuevo.',
  fields: {},
  retryAfter: null,
}

/** The client (and zod with it) loads only when the visitor runs the flow. */
const start: StartRun = async (request, options) => {
  let client: typeof import('./client')
  try {
    client = await import('./client')
  } catch {
    return LOAD_FAILED
  }
  return client.runAutomation(request, options)
}

/** Lab demo "Automatización en vivo": a test lead goes through a real n8n flow, step by step. */
export function AutomationDemo({
  services,
  turnstileSiteKey,
  whatsappUrl,
  workflowUrl,
}: AutomationDemoProps) {
  const run = useMemo(() => createAutomationRun({ start }), [])
  const form = useSignal<LeadForm>(EMPTY_FORM)
  const errors = useSignal<LeadErrors>({})
  /** How many examples were loaded: the button cycles through them. */
  const samples = useSignal(0)
  const token = useSignal<string | null>(null)
  const resetKey = useSignal(0)
  const missingToken = useSignal(false)
  /** A problem that belongs next to the form (verification, rate limits) rather than in the run. */
  const formProblem = useSignal<string | null>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)

  const phase = run.phase.value
  const busy = run.busy.value
  const sending = phase === 'sending'

  // The run ended: its result or its problem takes the focus, so it is read first.
  useEffect(() => {
    if (phase === 'done' || (phase === 'failed' && resultRef.current?.childElementCount)) {
      resultRef.current?.focus()
    }
  }, [phase])

  useEffect(() => () => run.stop(), [run])

  function update(field: LeadField, value: string) {
    form.value = { ...form.value, [field]: value }
    if (errors.value[field]) {
      const { [field]: _, ...rest } = errors.value
      errors.value = rest
    }
  }

  function loadSample() {
    const sample = SAMPLE_LEADS[samples.value % SAMPLE_LEADS.length]
    if (!sample) return
    samples.value += 1
    form.value = { ...sample.form }
    errors.value = {}
  }

  function focusFirstError(found: LeadErrors) {
    const first = FIELD_ORDER.find((field) => found[field])
    if (first) focusSoon(fieldId(first))
  }

  /** Puts a problem from the API where the visitor can fix it. */
  function placeProblem(problem: Problem | null) {
    if (!problem) return
    if (problem.kind === 'invalid') {
      const found = fieldsFromApi(problem.fields)
      errors.value = found
      if (Object.keys(found).length > 0) focusFirstError(found)
      else formProblem.value = problem.message
    } else if (problem.kind === 'captcha' || problem.kind === 'limited') {
      formProblem.value = problem.message
      setTimeout(() => alertRef.current?.focus(), 0)
    }
  }

  async function submit(event: Event) {
    event.preventDefault()
    if (busy) return
    formProblem.value = null
    const found = leadErrors(form.value, services)
    errors.value = found
    if (Object.keys(found).length > 0) {
      focusFirstError(found)
      return
    }
    const spent = token.value
    if (!spent) {
      missingToken.value = true
      focusSoon(TURNSTILE_ID)
      return
    }
    // Each Turnstile token is good for one run: ask for the next one now.
    token.value = null
    resetKey.value += 1
    const sent = run.submit({ turnstileToken: spent, lead: toLead(form.value) })
    titleRef.current?.focus()
    titleRef.current?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
    await sent
    if (run.phase.peek() === 'failed') placeProblem(run.problem.peek())
  }

  const loaded = samples.value === 0 ? null : SAMPLE_LEADS[(samples.value - 1) % SAMPLE_LEADS.length]

  return (
    <div class="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
      <section
        aria-labelledby={`${ID}-form-title`}
        class="grid min-w-0 gap-5 rounded-2xl border border-line bg-raised p-5 sm:p-8"
      >
        <div class="grid gap-2">
          <h2 id={`${ID}-form-title`} class="text-step-2 font-semibold">
            Solicitud de prueba
          </h2>
          <p class="text-step--1 text-muted">
            Llena el formulario como si fueras un cliente. n8n lo valida, lo califica, decide la ruta y
            redacta la respuesta.
          </p>
        </div>

        <div class="flex gap-3 rounded-xl border border-line bg-ink p-4 text-step--1">
          <Info size={20} class="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
          <p>
            <strong class="font-semibold">
              Usa datos de prueba: el correo no se envía, solo se muestra.
            </strong>{' '}
            La ejecución y sus pasos se borran en una hora.{' '}
            <a href="/privacidad/" class="link">
              Política de privacidad
            </a>
            .
          </p>
        </div>

        <div class="grid gap-2">
          <div>
            <button type="button" class="btn btn-quiet w-full sm:w-auto" disabled={busy} onClick={loadSample}>
              <FlaskConical size={18} aria-hidden="true" />
              Llenar con datos de ejemplo
            </button>
          </div>
          <p role="status" class="text-step--1 text-muted">
            {loaded
              ? `Ejemplo ${((samples.value - 1) % SAMPLE_LEADS.length) + 1} de ${SAMPLE_LEADS.length}: ${loaded.expect.toLowerCase()}. Púlsalo otra vez para ver otro caso.`
              : `Hay ${SAMPLE_LEADS.length} ejemplos: prioridad alta, prioridad media y una solicitud que el flujo rechaza.`}
          </p>
        </div>

        <form noValidate onSubmit={submit} aria-label="Solicitud de prueba" class="grid min-w-0 gap-4">
          <LeadInputs
            form={form.value}
            errors={errors.value}
            services={services}
            disabled={busy}
            onChange={update}
          />

          <div ref={alertRef} role="alert" tabIndex={-1}>
            {formProblem.value && (
              <div class="flex gap-2 rounded-lg border border-danger p-3 text-step--1">
                <CircleAlert size={18} class="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
                <p class="font-semibold">{formProblem.value}</p>
              </div>
            )}
          </div>

          <Turnstile
            id={TURNSTILE_ID}
            siteKey={turnstileSiteKey}
            action="automation"
            resetKey={resetKey.value}
            onToken={(next) => {
              token.value = next
              if (next) missingToken.value = false
            }}
            error={missingToken.value ? 'Completa la verificación de seguridad para continuar.' : undefined}
          />

          <div>
            {/* One button that changes role, so the focus stays put when the run starts or ends. */}
            {busy && !sending ? (
              <button
                type="button"
                class="btn btn-quiet w-full sm:w-auto"
                onClick={(event) => {
                  event.preventDefault()
                  run.stop()
                }}
              >
                <Square size={14} fill="currentColor" aria-hidden="true" />
                Detener
              </button>
            ) : (
              <button
                type="submit"
                class="btn btn-primary w-full aria-disabled:cursor-wait aria-disabled:opacity-80 sm:w-auto"
                aria-disabled={sending}
              >
                {sending ? <Spinner /> : <Play size={18} aria-hidden="true" />}
                {sending ? 'Enviando…' : phase === 'idle' ? 'Ejecutar el flujo' : 'Ejecutar otra vez'}
              </button>
            )}
          </div>
        </form>
      </section>

      <p role="status" class="sr-only">
        {run.announcement.value}
      </p>

      <RunPanel
        run={run}
        workflowUrl={workflowUrl}
        whatsappUrl={whatsappUrl}
        titleRef={titleRef}
        resultRef={resultRef}
        onRetry={() => {
          run.reset()
          focusSoon(fieldId('name'))
        }}
      />
    </div>
  )
}

interface LeadInputsProps {
  form: LeadForm
  errors: LeadErrors
  services: ServiceOption[]
  disabled: boolean
  onChange: (field: LeadField, value: string) => void
}

function LeadInputs({ form, errors, services, disabled, onChange }: LeadInputsProps) {
  const input = (field: LeadField, hint?: string) => ({
    ...a11yProps(fieldId(field), { hint, error: errors[field] }),
    disabled,
    class: inputClass,
  })
  const messageHint = 'Qué necesita el cliente. Con más de 80 caracteres suma puntos.'
  const countId = `${fieldId('message')}-count`
  const messageInput = input('message', messageHint)
  return (
    <>
      <Field id={fieldId('name')} label="Nombre" error={errors.name}>
        <input
          {...input('name')}
          type="text"
          autocomplete="off"
          maxLength={LIMITS.nameMax}
          value={form.name}
          onInput={(e) => onChange('name', e.currentTarget.value)}
        />
      </Field>
      <Field id={fieldId('company')} label="Empresa" optional error={errors.company}>
        <input
          {...input('company')}
          type="text"
          autocomplete="off"
          maxLength={LIMITS.companyMax}
          value={form.company}
          onInput={(e) => onChange('company', e.currentTarget.value)}
        />
      </Field>
      <Field id={fieldId('email')} label="Correo" error={errors.email}>
        <input
          {...input('email')}
          type="email"
          inputMode="email"
          autocomplete="off"
          maxLength={LIMITS.emailMax}
          value={form.email}
          onInput={(e) => onChange('email', e.currentTarget.value)}
        />
      </Field>
      <Field id={fieldId('service')} label="Servicio" error={errors.service}>
        <select
          {...input('service')}
          value={form.service}
          onChange={(e) => onChange('service', e.currentTarget.value)}
        >
          <option value="" disabled>
            Elige un servicio
          </option>
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.title}
            </option>
          ))}
        </select>
      </Field>
      <div class="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <Field id={fieldId('budget')} label="Presupuesto" error={errors.budget}>
          <select
            {...input('budget')}
            value={form.budget}
            onChange={(e) => {
              if (isBudget(e.currentTarget.value)) onChange('budget', e.currentTarget.value)
            }}
          >
            {BUDGETS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={fieldId('timeline')} label="Plazo" error={errors.timeline}>
          <select
            {...input('timeline')}
            value={form.timeline}
            onChange={(e) => {
              if (isTimeline(e.currentTarget.value)) onChange('timeline', e.currentTarget.value)
            }}
          >
            {TIMELINES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field id={fieldId('message')} label="Mensaje" hint={messageHint} error={errors.message}>
        <textarea
          {...messageInput}
          aria-describedby={`${messageInput['aria-describedby'] ?? ''} ${countId}`.trim()}
          rows={5}
          maxLength={LIMITS.messageMax}
          value={form.message}
          onInput={(e) => onChange('message', e.currentTarget.value)}
          class={`${inputClass} resize-y`}
        />
        <p id={countId} class="text-step--1 text-muted">
          {form.message.length} de {LIMITS.messageMax} caracteres
        </p>
      </Field>
    </>
  )
}
