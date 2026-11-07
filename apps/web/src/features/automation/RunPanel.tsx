import type { AutomationStep, AutomationStepEvent } from '@aim/contracts'
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  ExternalLink,
  LoaderCircle,
} from 'lucide-preact'
import type { RefObject } from 'preact'
import { NEW_TAB, PausedNotice } from '../assistant/parts'
import type { AutomationRun } from './run'
import { StepDetails } from './StepDetails'
import {
  formatMs,
  formatSeconds,
  OUTCOME_LABELS,
  STATUS_TEXT,
  STEP_INFO,
  STEPS,
  type StepStatus,
} from './steps'

export const RUN_TITLE_ID = 'automation-run-title'

interface RunPanelProps {
  run: AutomationRun
  workflowUrl: string
  whatsappUrl: string
  titleRef: RefObject<HTMLHeadingElement>
  resultRef: RefObject<HTMLDivElement>
  onRetry: () => void
}

/** The run: where it stands (sending, the result or the problem), then the seven steps. */
export function RunPanel({ run, workflowUrl, whatsappUrl, titleRef, resultRef, onRetry }: RunPanelProps) {
  const phase = run.phase.value
  return (
    <section
      aria-labelledby={RUN_TITLE_ID}
      class="grid min-w-0 content-start gap-5 rounded-2xl border border-line bg-raised p-5 sm:p-8"
    >
      <div class="grid gap-2">
        <h2 id={RUN_TITLE_ID} ref={titleRef} tabIndex={-1} class="text-step-2 font-semibold">
          Ejecución del flujo
        </h2>
        <p class="text-step--1 text-muted">
          Cada paso aparece con el tiempo que tomó desde que empezó el flujo.
        </p>
      </div>

      {phase === 'sending' && (
        <p class="flex items-center gap-2 text-step--1">
          <LoaderCircle
            size={18}
            class="shrink-0 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          Enviando la solicitud…
        </p>
      )}

      <div ref={resultRef} tabIndex={-1} class="grid min-w-0 gap-4 empty:hidden">
        {phase === 'done' && <Result run={run} workflowUrl={workflowUrl} />}
        {phase === 'stopped' && <p class="text-step--1 text-muted">Detuviste la ejecución.</p>}
        {phase === 'failed' && <Failure run={run} whatsappUrl={whatsappUrl} onRetry={onRetry} />}
      </div>

      <Timeline run={run} />
    </section>
  )
}

function Result({ run, workflowUrl }: { run: AutomationRun; workflowUrl: string }) {
  const result = run.result.value
  const steps = run.steps.value
  if (!result) return null
  const accepted = result.outcome === 'accepted'
  return (
    <div class="grid gap-3 rounded-xl border border-line bg-ink p-4">
      <p class="flex items-center gap-2 text-step-1 font-semibold">
        {accepted ? (
          <CircleCheck size={22} class="shrink-0 text-live" aria-hidden="true" />
        ) : (
          <CircleX size={22} class="shrink-0 text-danger" aria-hidden="true" />
        )}
        {OUTCOME_LABELS[result.outcome]}
      </p>
      <dl class="grid gap-1 text-step--1 sm:grid-cols-[auto_1fr] sm:gap-x-4">
        {steps.received && (
          <>
            <dt class="text-muted">Flujo</dt>
            <dd>
              <span class="font-semibold">{steps.received.data.flow}</span> (diseñado en n8n)
            </dd>
          </>
        )}
        {steps.recorded && (
          <>
            <dt class="text-muted">Referencia</dt>
            <dd class="font-semibold">{steps.recorded.data.reference}</dd>
          </>
        )}
        <dt class="text-muted">Duración del flujo</dt>
        <dd class="tabular-nums">{formatMs(result.totalMs)}</dd>
        <dt class="text-muted">Del clic al resultado</dt>
        <dd class="font-semibold tabular-nums">{formatSeconds(result.clickToResultMs)}</dd>
      </dl>
      <p class="text-step--1 text-muted">
        Lo mide tu navegador: incluye la red y la pausa corta entre pasos para que puedas leerlos.
      </p>
      <p class="text-step--1">
        <a
          href={workflowUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="link inline-flex items-center gap-1"
        >
          Ver el flujo de n8n en GitHub
          <ExternalLink size={14} aria-hidden="true" />
          {NEW_TAB}
        </a>
      </p>
    </div>
  )
}

interface FailureProps {
  run: AutomationRun
  whatsappUrl: string
  onRetry: () => void
}

/** What stopped the run, as an alert. */
function Failure({ run, whatsappUrl, onRetry }: FailureProps) {
  const problem = run.problem.value
  // Field errors and the verification are shown next to the form, where they are fixed.
  if (!problem || problem.kind === 'invalid' || problem.kind === 'captcha') {
    return null
  }
  if (problem.kind === 'paused') {
    return <PausedNotice title="La demo está en pausa" whatsappUrl={whatsappUrl} onRetry={onRetry} />
  }
  return (
    <div role="alert" class="flex gap-2 rounded-lg border border-danger p-3 text-step--1">
      <CircleAlert size={18} class="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
      <p class="font-semibold">{problem.message}</p>
    </div>
  )
}

const STATUS_ICON: Record<StepStatus, typeof CircleCheck> = {
  pending: CircleDashed,
  active: LoaderCircle,
  done: CircleCheck,
  skipped: CircleMinus,
}

const STATUS_CLASS: Record<StepStatus, string> = {
  pending: 'text-muted',
  active: 'text-brand animate-spin motion-reduce:animate-none',
  done: 'text-live',
  skipped: 'text-muted',
}

/** The seven steps, in order. A step's panel shows what the flow reported once it arrives. */
function Timeline({ run }: { run: AutomationRun }) {
  const statuses = run.statuses.value
  const steps = run.steps.value
  return (
    <ol aria-label="Pasos del flujo" class="grid min-w-0">
      {STEPS.map((step, index) => (
        <TimelineStep
          key={step}
          step={step}
          number={index + 1}
          status={statuses[step]}
          last={index === STEPS.length - 1}
          event={steps[step]}
        />
      ))}
    </ol>
  )
}

interface TimelineStepProps {
  step: AutomationStep
  number: number
  status: StepStatus
  last: boolean
  event: AutomationStepEvent | undefined
}

function TimelineStep({ step, number, status, last, event }: TimelineStepProps) {
  const Icon = STATUS_ICON[status]
  const info = STEP_INFO[step]
  const dim = status === 'pending' || status === 'skipped'
  return (
    <li class="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3" data-step={step} data-status={status}>
      <div class="flex flex-col items-center">
        <Icon size={24} class={`shrink-0 ${STATUS_CLASS[status]}`} aria-hidden="true" />
        {!last && <span class={`mt-1 w-px flex-1 ${status === 'done' ? 'bg-live' : 'bg-line'}`} />}
      </div>
      <div class={`grid min-w-0 gap-2 ${last ? '' : 'pb-5'}`}>
        <div class="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 class={`text-step-0 font-semibold ${dim ? 'text-muted' : ''}`}>
            <span class="sr-only">Paso {number}: </span>
            {info.title}
            <span class="sr-only">. {STATUS_TEXT[status]}.</span>
          </h3>
          {event ? (
            <span class="text-step--1 text-muted tabular-nums">
              <span class="sr-only">Desde el inicio: </span>
              {event.atMs >= 1 ? '+' : ''}
              {formatMs(event.atMs)}
            </span>
          ) : (
            <span class="text-step--1 text-muted" aria-hidden="true">
              {STATUS_TEXT[status]}
            </span>
          )}
        </div>
        {!event && <p class="text-step--1 text-muted">{info.description}</p>}
        {event && <StepDetails event={event} />}
      </div>
    </li>
  )
}
