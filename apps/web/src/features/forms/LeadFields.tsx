import type { LeadErrors } from '../../lib/lead'
import { a11yProps, checkboxClass, Field, FieldError, inputClass } from './fields'

// Inputs that /contacto/ and the cotizador share. Ids are `${prefix}-email`, `${prefix}-phone`, `${prefix}-consent`.

interface ReachProps {
  prefix: string
  email: string
  phone: string
  errors: LeadErrors
  onEmail: (value: string) => void
  onPhone: (value: string) => void
}

/** E-mail and phone: the contract needs at least one of them. */
export function ReachFields({ prefix, email, phone, errors, onEmail, onPhone }: ReachProps) {
  const hintId = `${prefix}-reach-hint`
  const phoneHint = 'Si no es de Colombia, empieza con + y el indicativo, por ejemplo +1 305 555 1234.'
  return (
    <fieldset class="grid min-w-0 gap-4" aria-describedby={hintId}>
      <legend class="mb-1 font-semibold">¿Cómo te respondo?</legend>
      <p id={hintId} class="text-step--1 text-muted">
        Deja tu correo, tu teléfono o los dos.
      </p>
      <Field id={`${prefix}-email`} label="Correo" error={errors.email}>
        <input
          {...a11yProps(`${prefix}-email`, { error: errors.email })}
          type="email"
          inputMode="email"
          autocomplete="email"
          maxLength={254}
          value={email}
          onInput={(e) => onEmail(e.currentTarget.value)}
          class={inputClass}
        />
      </Field>
      <Field id={`${prefix}-phone`} label="Teléfono o WhatsApp" hint={phoneHint} error={errors.phone}>
        <input
          {...a11yProps(`${prefix}-phone`, { hint: phoneHint, error: errors.phone })}
          type="tel"
          inputMode="tel"
          autocomplete="tel"
          maxLength={30}
          value={phone}
          onInput={(e) => onPhone(e.currentTarget.value)}
          class={inputClass}
        />
      </Field>
    </fieldset>
  )
}

interface ConsentProps {
  prefix: string
  checked: boolean
  error?: string
  onChange: (checked: boolean) => void
}

/** Explicit acceptance of the privacy policy (Ley 1581 de 2012). The policy opens in a new tab to keep the form. */
export function ConsentField({ prefix, checked, error, onChange }: ConsentProps) {
  const id = `${prefix}-consent`
  return (
    <div class="grid min-w-0 gap-1.5">
      <div class="flex gap-3">
        <input
          {...a11yProps(id, { error })}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.currentTarget.checked)}
          class={checkboxClass}
        />
        <label for={id}>
          Acepto que se usen estos datos para responder mi mensaje, como explica la{' '}
          <a href="/privacidad/" target="_blank" rel="noopener" class="link">
            política de privacidad
            <span class="sr-only"> (se abre en otra pestaña)</span>
          </a>
          .
        </label>
      </div>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  )
}
