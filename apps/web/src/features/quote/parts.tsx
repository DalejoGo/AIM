import type { Price } from '@aim/contracts'
import type { ComponentChildren } from 'preact'
import { formatMoney } from '../../lib/money'
import { CURRENCY_LIST } from './logic'

/**
 * Renders the amount in every currency; global.css shows the one chosen in the header (DEC-010),
 * so static prices are right before the island hydrates and follow the switch without JavaScript.
 */
export function Money({ price }: { price: Price }) {
  return (
    <>
      {CURRENCY_LIST.map((currency) => (
        <span key={currency} data-price={currency} class="whitespace-nowrap">
          {formatMoney(price[currency], currency)}
        </span>
      ))}
    </>
  )
}

interface StepHeadingProps {
  number: number
  title: string
  id?: string
}

/** Steps are a real sequence, so they are numbered (docs/DISENO.md). */
export function StepHeading({ number, title, id }: StepHeadingProps) {
  return (
    <h2 id={id} class="flex items-center gap-3 text-step-1 font-semibold md:text-step-2">
      <span
        aria-hidden="true"
        class="grid size-9 shrink-0 place-items-center rounded-full border border-line font-display text-step-0 text-brand"
      >
        {number}
      </span>
      <span>
        <span class="sr-only">Paso {number}: </span>
        {title}
      </span>
    </h2>
  )
}

interface StepProps extends StepHeadingProps {
  id: string
  hint?: string
  children: ComponentChildren
}

/** A numbered step that groups inputs: the heading is the fieldset's legend. */
export function Step({ number, title, id, hint, children }: StepProps) {
  const hintId = `${id}-hint`
  return (
    <fieldset id={id} class="min-w-0 scroll-mt-24" aria-describedby={hint ? hintId : undefined}>
      <legend class="w-full">
        <StepHeading number={number} title={title} />
      </legend>
      {hint && (
        <p id={hintId} class="mt-2 text-muted">
          {hint}
        </p>
      )}
      <div class="mt-5">{children}</div>
    </fieldset>
  )
}

/** Shared look of every radio and checkbox row; the selected row is outlined in the brand color. */
export const choiceClass =
  'flex cursor-pointer gap-4 rounded-xl border border-line bg-raised p-4 transition-colors hover:border-brand has-[:checked]:border-brand has-[:checked]:ring-1 has-[:checked]:ring-brand sm:p-5'

export const inputClass = 'mt-1 size-5 shrink-0 cursor-pointer accent-brand'
