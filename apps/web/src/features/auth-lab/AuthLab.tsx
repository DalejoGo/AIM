import type { ComponentType } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { ActorDiagram } from './ActorDiagram'
import { blockedHint, stepCopy } from './copy'
import { StepAuthorize, StepCallback, StepConsent, StepExchange, StepPrepare, StepTokens } from './steps'
import { type AuthLabStore, createAuthLab, STEPS, type Step } from './store'

const bodies: Record<Step, ComponentType<{ lab: AuthLabStore }>> = {
  1: StepPrepare,
  2: StepAuthorize,
  3: StepConsent,
  4: StepCallback,
  5: StepExchange,
  6: StepTokens,
}

/** Where you are in the sequence. Not interactive: the order matters, so you move with the buttons. */
function Progress({ step }: { step: Step }) {
  return (
    <ol aria-label="Pasos del recorrido" class="grid grid-cols-6 gap-1.5 sm:gap-3">
      {STEPS.map((n) => (
        <li
          key={n}
          aria-current={n === step ? 'step' : undefined}
          class={`grid content-start gap-1 border-t-4 pt-2 text-step--1 transition-colors ${
            n <= step ? 'border-brand' : 'border-line'
          }`}
        >
          <span
            aria-hidden="true"
            class={`font-semibold tabular-nums ${n === step ? 'text-text' : 'text-muted'}`}
          >
            {n}
          </span>
          <span
            class={`sr-only leading-snug md:not-sr-only ${n === step ? 'font-semibold text-text' : 'text-muted'}`}
          >
            {stepCopy[n].short}
            {n < step && <span class="sr-only"> (hecho)</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Auth Lab: the Authorization Code + PKCE flow with OpenID Connect, simulated in the browser with real crypto. */
export function AuthLab() {
  const [lab] = useState(createAuthLab)
  const heading = useRef<HTMLHeadingElement>(null)
  const step = lab.step.value
  const moves = lab.moves.value
  const canAdvance = lab.canAdvance.value
  const copy = stepCopy[step]
  const Body = bodies[step]
  const hint = step === 6 || !canAdvance ? blockedHint[step] : undefined

  useEffect(() => {
    void lab.start()
  }, [lab])

  // Every move lands on the new step's title, so keyboard and screen reader users start reading there.
  useEffect(() => {
    if (moves > 0) heading.current?.focus()
  }, [moves])

  return (
    <div class="grid gap-8">
      <Progress step={step} />

      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_auto_auto_1fr] lg:gap-x-12">
        <header class="grid gap-4 lg:col-start-1">
          <h2 ref={heading} tabIndex={-1} class="text-step-2 font-semibold md:text-step-3">
            <span class="mb-2 block font-sans text-step--1 font-normal tracking-normal text-muted">
              Paso {step} de {STEPS.length}
            </span>
            {copy.title}
          </h2>
          <div class="prose-measure grid gap-3">
            {copy.intro.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </header>

        <div class="min-w-0 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-4 lg:row-start-1 lg:self-start">
          <ActorDiagram step={step} />
        </div>

        <div class="min-w-0 lg:col-start-1">
          <Body lab={lab} />
        </div>

        <div class="grid gap-3 border-t border-line pt-6 lg:col-start-1">
          <nav aria-label="Recorrido" class="flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="btn btn-quiet disabled:cursor-not-allowed disabled:opacity-50"
              disabled={step === 1}
              onClick={lab.previous}
            >
              Paso anterior
            </button>
            {step < STEPS.length && (
              <button
                type="button"
                class="btn btn-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                aria-disabled={!canAdvance}
                aria-describedby={hint ? 'auth-lab-hint' : undefined}
                onClick={() => void lab.next()}
              >
                Siguiente paso
              </button>
            )}
            <button
              type="button"
              class={`btn sm:ml-auto ${step === STEPS.length ? 'btn-primary' : 'btn-quiet'}`}
              onClick={() => void lab.reset()}
            >
              Reiniciar
            </button>
          </nav>
          {hint && (
            <p id="auth-lab-hint" class="text-step--1 text-muted">
              {hint}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
