import type { AutomationStepEvent } from '@aim/contracts'
import { CircleCheck, CircleX } from 'lucide-preact'
import { formatPoints, TIER_LABELS } from './steps'

/** What the flow reported in one step. Everything is rendered as text: nothing from the flow becomes HTML. */
export function StepDetails({ event }: { event: AutomationStepEvent }) {
  switch (event.step) {
    case 'received':
      return (
        <p class="text-step--1">
          Flujo <span class="font-semibold">{event.data.flow}</span>
        </p>
      )
    case 'validated':
      return <Checks data={event.data} />
    case 'scored':
      return <Score data={event.data} />
    case 'routed':
      return (
        <dl class="grid gap-1 text-step--1 sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt class="text-muted">Ruta</dt>
          <dd class="font-semibold">{event.data.label}</dd>
          <dt class="text-muted">Siguiente paso</dt>
          <dd>{event.data.sla}</dd>
        </dl>
      )
    case 'drafted':
      return <EmailPreview subject={event.data.subject} body={event.data.body} />
    case 'recorded':
      return (
        <p class="text-step--1">
          Referencia <span class="font-semibold tracking-wide">{event.data.reference}</span>
        </p>
      )
    case 'done':
      return null
  }
}

type Data<S extends AutomationStepEvent['step']> = Extract<AutomationStepEvent, { step: S }>['data']

function Checks({ data }: { data: Data<'validated'> }) {
  const passed = data.checks.filter((check) => check.ok).length
  return (
    <div class="grid gap-2 text-step--1">
      <ul class="grid gap-1">
        {data.checks.map((check) => (
          <li key={check.id} class="flex items-start gap-2">
            {check.ok ? (
              <CircleCheck size={16} class="mt-1 shrink-0 text-live" aria-hidden="true" />
            ) : (
              <CircleX size={16} class="mt-1 shrink-0 text-danger" aria-hidden="true" />
            )}
            <span>
              <span class="sr-only">{check.ok ? 'Cumple: ' : 'No cumple: '}</span>
              {check.label}
            </span>
          </li>
        ))}
      </ul>
      <p class={data.valid ? 'text-muted' : 'font-semibold text-danger'}>
        {data.valid
          ? `${passed} de ${data.checks.length} reglas cumplidas: la solicitud sigue.`
          : 'La solicitud no pasó la validación: el flujo la rechaza y termina.'}
      </p>
    </div>
  )
}

function Score({ data }: { data: Data<'scored'> }) {
  return (
    <div class="grid gap-3 text-step--1">
      <div class="grid gap-1.5">
        <p class="flex flex-wrap items-baseline justify-between gap-x-3">
          <span>
            <span class="text-step-1 font-semibold tabular-nums">{data.score}</span>
            <span class="text-muted"> de 100 puntos</span>
          </span>
          <span class="font-semibold">{TIER_LABELS[data.tier]}</span>
        </p>
        {/* The bar is drawn with SVG attributes: the CSP blocks style attributes. */}
        <svg viewBox="0 0 100 4" preserveAspectRatio="none" class="h-2 w-full" aria-hidden="true">
          <rect width="100" height="4" rx="2" class="fill-line" />
          <rect width={data.score} height="4" rx="2" class="fill-brand" />
        </svg>
      </div>
      {data.factors.length > 0 && (
        <ul class="grid gap-1">
          {data.factors.map((factor) => (
            <li key={factor.label} class="flex items-baseline justify-between gap-3">
              <span>{factor.label}</span>
              <span class="shrink-0 font-semibold tabular-nums">{formatPoints(factor.points)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function EmailPreview({ subject, body }: { subject: string; body: string }) {
  return (
    <figure class="grid min-w-0 gap-2 rounded-lg border border-line bg-ink p-3 text-step--1 sm:p-4">
      <figcaption class="text-muted">Vista previa del correo. No se envía.</figcaption>
      <p class="[overflow-wrap:anywhere]">
        <span class="text-muted">Asunto: </span>
        <span class="font-semibold">{subject}</span>
      </p>
      <p class="whitespace-pre-line [overflow-wrap:anywhere]">{body}</p>
    </figure>
  )
}
