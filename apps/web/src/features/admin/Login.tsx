import { type Principal, RequestCode } from '@aim/contracts'
import { useSignal } from '@preact/signals'
import { KeyRound, Mail } from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'
import { ApiRequestError, api, messageForStatus } from '../../lib/api'
import { a11yProps, Field, FormAlert, focusSoon, inputClass, Spinner } from '../forms/fields'
import { Turnstile } from '../turnstile/Turnstile'

export interface Notice {
  tone: 'info' | 'error'
  text: string
}

interface LoginProps {
  turnstileSiteKey: string
  /** Why the visitor is here: session ended, signed out, or the check failed. */
  notice: Notice | null
  onSignedIn: (principal: Principal) => void
}

type Step = 'email' | 'code'

interface Errors {
  email?: string
  turnstile?: string
  code?: string
}

const IDS = { email: 'login-email', turnstile: 'login-turnstile', code: 'login-code' } as const
const CODE = /^\d{6}$/

const errorMessage = (error: unknown) =>
  error instanceof ApiRequestError ? error.message : messageForStatus(0)

/** Two steps (DEC-017): e-mail and Turnstile, then the 6-digit code that arrives by e-mail. */
export function Login({ turnstileSiteKey, notice, onSignedIn }: LoginProps) {
  const step = useSignal<Step>('email')
  const email = useSignal('')
  const code = useSignal('')
  const sentMessage = useSignal('')
  const errors = useSignal<Errors>({})
  const formError = useSignal<string | null>(null)
  const busy = useSignal(false)
  const token = useSignal<string | null>(null)
  const resetKey = useSignal(0)
  const alertRef = useRef<HTMLDivElement>(null)
  const sentRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (step.value === 'code') sentRef.current?.focus()
  }, [step.value])

  function fail(found: Errors, form: string | null = null) {
    errors.value = found
    formError.value = form
    const first = (['email', 'turnstile', 'code'] as const).find((k) => found[k])
    if (first) focusSoon(IDS[first])
    else alertRef.current?.focus()
  }

  async function sendCode(event: Event) {
    event.preventDefault()
    if (busy.value) return
    const parsed = RequestCode.safeParse({ email: email.value.trim(), turnstileToken: token.value ?? '' })
    if (!parsed.success) {
      const paths = new Set(parsed.error.issues.map((i) => i.path[0]))
      fail({
        email: paths.has('email') ? 'Escribe un correo válido, como nombre@dominio.com.' : undefined,
        turnstile: paths.has('turnstileToken') ? 'Completa la verificación de seguridad.' : undefined,
      })
      return
    }
    busy.value = true
    try {
      const sent = await api.requestCode(parsed.data)
      email.value = parsed.data.email
      sentMessage.value = sent.message
      errors.value = {}
      formError.value = null
      code.value = ''
      step.value = 'code'
    } catch (error) {
      token.value = null
      resetKey.value += 1
      if (error instanceof ApiRequestError && error.code === 'captcha_failed')
        fail({ turnstile: error.message })
      else if (error instanceof ApiRequestError && error.fields.email)
        fail({ email: 'Escribe un correo válido, como nombre@dominio.com.' }, error.message)
      else fail({}, errorMessage(error))
    } finally {
      busy.value = false
    }
  }

  async function signIn(event: Event) {
    event.preventDefault()
    if (busy.value) return
    const digits = code.value.replace(/\D/g, '')
    if (!CODE.test(digits)) {
      fail({ code: 'Escribe los 6 dígitos del código que te llegó al correo.' })
      return
    }
    busy.value = true
    try {
      await api.signIn(email.value, digits)
      onSignedIn(await api.me())
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'invalid_grant') fail({ code: error.message })
      else fail({}, errorMessage(error))
    } finally {
      busy.value = false
    }
  }

  function askAgain() {
    step.value = 'email'
    errors.value = {}
    formError.value = null
    token.value = null
    focusSoon(IDS.email)
  }

  const e = errors.value
  return (
    <section aria-labelledby="login-title" class="grid max-w-lg gap-6">
      <div class="grid gap-2">
        <h2 id="login-title" class="text-step-2 font-semibold">
          Entrar al panel
        </h2>
        <p class="text-muted">Sin contraseña: te llega un código de un solo uso a tu correo.</p>
      </div>

      <div role="status">
        {notice && (
          <p
            class={`rounded-lg border p-3 text-step--1 ${notice.tone === 'error' ? 'border-danger' : 'border-line'}`}
          >
            {notice.text}
          </p>
        )}
      </div>

      {step.value === 'email' ? (
        <form
          noValidate
          onSubmit={sendCode}
          class="grid gap-6 rounded-2xl border border-line bg-raised p-5 sm:p-6"
        >
          <Field id={IDS.email} label="Correo" error={e.email}>
            <input
              {...a11yProps(IDS.email, { error: e.email })}
              type="email"
              inputMode="email"
              autocomplete="username"
              maxLength={254}
              value={email.value}
              onInput={(ev) => {
                email.value = ev.currentTarget.value
                if (e.email) errors.value = { ...e, email: undefined }
              }}
              class={inputClass}
            />
          </Field>
          <Turnstile
            id={IDS.turnstile}
            siteKey={turnstileSiteKey}
            action="admin-login"
            onToken={(next) => {
              token.value = next
              if (next && errors.value.turnstile) errors.value = { ...errors.value, turnstile: undefined }
            }}
            resetKey={resetKey.value}
            error={e.turnstile}
          />
          <div class="grid gap-3">
            <FormAlert message={formError.value} alertRef={alertRef} />
            <button
              type="submit"
              class="btn btn-primary aria-disabled:cursor-wait aria-disabled:opacity-80"
              aria-disabled={busy.value}
            >
              {busy.value ? <Spinner /> : <Mail size={18} aria-hidden="true" />}
              {busy.value ? 'Enviando el código…' : 'Enviarme un código'}
            </button>
          </div>
        </form>
      ) : (
        <form
          noValidate
          onSubmit={signIn}
          class="grid gap-6 rounded-2xl border border-line bg-raised p-5 sm:p-6"
        >
          <div class="grid gap-2">
            <h3 ref={sentRef} tabIndex={-1} class="text-step-1 font-semibold">
              Te enviamos un código
            </h3>
            <p class="text-step--1">{sentMessage.value}</p>
            <p class="text-step--1 text-muted">
              Correo: <span class="font-semibold text-text [overflow-wrap:anywhere]">{email.value}</span>
            </p>
          </div>
          <Field id={IDS.code} label="Código de 6 dígitos" hint="Vence en 10 minutos." error={e.code}>
            <input
              {...a11yProps(IDS.code, { hint: true, error: e.code })}
              type="text"
              inputMode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]*"
              maxLength={12}
              value={code.value}
              onInput={(ev) => {
                code.value = ev.currentTarget.value
                if (e.code) errors.value = { ...e, code: undefined }
              }}
              class={`${inputClass} max-w-48 text-step-1 tracking-[0.3em] tabular-nums`}
            />
          </Field>
          <div class="grid gap-3">
            <FormAlert message={formError.value} alertRef={alertRef} />
            <div class="flex flex-wrap gap-3">
              <button
                type="submit"
                class="btn btn-primary grow aria-disabled:cursor-wait aria-disabled:opacity-80"
                aria-disabled={busy.value}
              >
                {busy.value ? <Spinner /> : <KeyRound size={18} aria-hidden="true" />}
                {busy.value ? 'Entrando…' : 'Entrar'}
              </button>
              <button type="button" class="btn btn-quiet grow" onClick={askAgain}>
                Pedir otro código
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  )
}
