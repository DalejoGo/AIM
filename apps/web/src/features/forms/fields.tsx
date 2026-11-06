import { CircleAlert, LoaderCircle } from 'lucide-preact'
import type { ComponentChildren, Ref } from 'preact'

/** Shared look of text inputs, selects and text areas; an invalid one gets the danger border. */
export const inputClass =
  'w-full min-w-0 rounded-lg border border-line bg-ink px-3 py-2.5 text-text placeholder:text-muted hover:border-brand aria-[invalid=true]:border-danger'

export const checkboxClass = 'mt-1 size-5 shrink-0 cursor-pointer accent-brand'

/** aria-describedby for an input with an optional hint and error: `${id}-hint` and `${id}-error`. */
export function describedBy(id: string, { hint, error }: { hint?: unknown; error?: unknown }) {
  const ids = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean)
  return ids.length > 0 ? ids.join(' ') : undefined
}

/** Props every input in a Field spreads, so label, hint and error stay wired the same way. */
export function a11yProps(id: string, { hint, error }: { hint?: unknown; error?: unknown }) {
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy(id, { hint, error }),
  } as const
}

export function FieldError({ id, children }: { id: string; children: ComponentChildren }) {
  return (
    <p id={id} class="flex gap-1.5 text-step--1 text-danger">
      <CircleAlert size={16} class="mt-1 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

interface FieldProps {
  id: string
  label: ComponentChildren
  optional?: boolean
  hint?: ComponentChildren
  error?: string
  children: ComponentChildren
}

/** Label, hint (read with the input) and error under it. The input inside uses a11yProps(id, …). */
export function Field({ id, label, optional = false, hint, error, children }: FieldProps) {
  return (
    <div class="grid min-w-0 gap-1.5">
      <label for={id} class="font-semibold">
        {label}
        {optional && <span class="font-normal text-muted"> (opcional)</span>}
      </label>
      {hint && (
        <p id={`${id}-hint`} class="text-step--1 text-muted">
          {hint}
        </p>
      )}
      {children}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  )
}

/**
 * Error for the whole form. The region is always in the page so screen readers announce new text;
 * it takes the focus when there is no field to send the visitor to.
 */
export function FormAlert({
  message,
  children,
  alertRef,
}: {
  message: string | null
  children?: ComponentChildren
  alertRef?: Ref<HTMLDivElement>
}) {
  return (
    <div ref={alertRef} role="alert" tabIndex={-1}>
      {message && (
        <div class="mb-1 flex gap-2 rounded-lg border border-danger p-3 text-step--1">
          <CircleAlert size={18} class="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
          <div class="grid gap-1">
            <p class="font-semibold">{message}</p>
            {children}
          </div>
        </div>
      )}
    </div>
  )
}

/** Spinner for buttons that are waiting on the network; still under reduced motion. */
export function Spinner() {
  return <LoaderCircle size={18} class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
}

/** Moves the focus after the pending render, so the error it points to is already in the page when read. */
export function focusSoon(id: string): void {
  setTimeout(() => document.getElementById(id)?.focus(), 0)
}
