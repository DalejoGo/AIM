import { CircleCheck, CircleX } from 'lucide-preact'
import type { ComponentChildren } from 'preact'
import type { Outcome } from './copy'

/** A raised block inside the demo, optionally titled. */
export function Panel({ title, children }: { title?: string; children: ComponentChildren }) {
  return (
    <section class="grid min-w-0 gap-5 rounded-xl border border-line bg-raised p-4 sm:p-6">
      {title && <h3 class="text-step-0 font-semibold">{title}</h3>}
      {children}
    </section>
  )
}

/**
 * A real value (token, URL, hash): monospaced and free to break anywhere so it never overflows.
 * Multiline values (indented JSON) keep their line breaks.
 */
export function Code({ children, multiline = false }: { children: ComponentChildren; multiline?: boolean }) {
  const base = 'block rounded-lg bg-ink px-3 py-2 font-mono text-step--1 leading-relaxed break-all'
  return multiline ? (
    <pre class={`${base} whitespace-pre-wrap`}>{children}</pre>
  ) : (
    <code class={base}>{children}</code>
  )
}

/** One row of a <dl>: a name, its value and an optional explanation. */
export function ValueRow({
  name,
  value,
  hint,
  multiline,
}: {
  name: string
  value: ComponentChildren
  hint?: string
  multiline?: boolean
}) {
  return (
    <div class="grid min-w-0 gap-1.5">
      <dt class="font-semibold">{name}</dt>
      <dd>
        <Code multiline={multiline}>{value}</Code>
      </dd>
      {hint && <dd class="text-step--1 text-muted">{hint}</dd>}
    </div>
  )
}

const fieldClass =
  'w-full rounded-lg border border-line bg-ink px-3 py-2 font-mono text-step--1 text-text hover:border-brand'

/** A single-line editable value, labelled and explained. */
export function ValueInput({
  id,
  label,
  hint,
  value,
  onInput,
}: {
  id: string
  label: string
  hint: string
  value: string
  onInput: (value: string) => void
}) {
  return (
    <div class="grid min-w-0 gap-1.5">
      <label for={id} class="font-semibold">
        {label}
      </label>
      <input
        id={id}
        type="text"
        class={fieldClass}
        value={value}
        onInput={(event) => onInput(event.currentTarget.value)}
        aria-describedby={`${id}-hint`}
        spellcheck={false}
        autocomplete="off"
        autocapitalize="off"
      />
      <p id={`${id}-hint`} class="text-step--1 text-muted">
        {hint}
      </p>
    </div>
  )
}

export function ValueTextarea({
  id,
  label,
  hint,
  value,
  onInput,
}: {
  id: string
  label: string
  hint: string
  value: string
  onInput: (value: string) => void
}) {
  return (
    <div class="grid min-w-0 gap-1.5">
      <label for={id} class="font-semibold">
        {label}
      </label>
      <textarea
        id={id}
        rows={11}
        class={`${fieldClass} leading-relaxed`}
        value={value}
        onInput={(event) => onInput(event.currentTarget.value)}
        aria-describedby={`${id}-hint`}
        spellcheck={false}
        autocomplete="off"
        autocapitalize="off"
      />
      <p id={`${id}-hint`} class="text-step--1 text-muted">
        {hint}
      </p>
    </div>
  )
}

export function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <CircleCheck aria-hidden="true" class="mt-0.5 size-5 shrink-0 text-live" />
  ) : (
    <CircleX aria-hidden="true" class="mt-0.5 size-5 shrink-0 text-danger" />
  )
}

/**
 * The result of a security check. The live region is always in the DOM, so screen readers announce
 * each change; its text only changes when the outcome does, not on every keystroke.
 */
export function Verdict({ outcome, pending }: { outcome: Outcome | null; pending?: string }) {
  return (
    <div role="status" class="min-w-0">
      {outcome ? (
        <p
          class={`flex items-start gap-3 rounded-lg border-l-4 bg-ink px-4 py-3 ${outcome.ok ? 'border-live' : 'border-danger'}`}
        >
          <StatusIcon ok={outcome.ok} />
          <span>
            <strong class="font-semibold">{outcome.title}.</strong> {outcome.detail}
          </span>
        </p>
      ) : (
        pending && <p class="text-step--1 text-muted">{pending}</p>
      )}
    </div>
  )
}

/** Buttons that simulate an attack or undo it. */
export function TamperActions({ children }: { children: ComponentChildren }) {
  return <div class="flex flex-wrap gap-3">{children}</div>
}

export function QuietButton({ onClick, children }: { onClick: () => void; children: ComponentChildren }) {
  return (
    <button type="button" class="btn btn-quiet text-step--1" onClick={onClick}>
      {children}
    </button>
  )
}
