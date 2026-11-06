import { AppWindow, Database, type LucideIcon, Monitor, ShieldCheck } from 'lucide-preact'
import { ACTORS, type ActorId, actorNames, describeMessage, type Message, stepCopy } from './copy'
import type { Step } from './store'

const icons: Record<ActorId, LucideIcon> = {
  browser: Monitor,
  app: AppWindow,
  server: ShieldCheck,
  api: Database,
}

const labelClass = 'text-[0.75rem] leading-snug sm:text-step--1'

// Positions are static class names, never inline style attributes: the CSP (src/lib/csp.ts) blocks those.
const COL_START = ['col-start-1', 'col-start-2', 'col-start-3', 'col-start-4']
const COL_SPAN = ['', 'col-span-1', 'col-span-2', 'col-span-3', 'col-span-4']
/** The centre of the first column of a span of n columns sits at 50/n % of the span's width (index: n). */
const DOT_LEFT = ['', 'left-[50%]', 'left-[25%]', 'left-[16.6667%]', 'left-[12.5%]']
const LABEL_INDENT = [
  '',
  'pl-[calc(50%_+_0.75rem)]',
  'pl-[calc(25%_+_0.75rem)]',
  'pl-[calc(16.6667%_+_0.75rem)]',
  'pl-[calc(12.5%_+_0.75rem)]',
]
const ARROW_INSET = ['', 'inset-x-[50%]', 'inset-x-[25%]', 'inset-x-[16.6667%]', 'inset-x-[12.5%]']
/** Each actor's lifeline, at the centre of its column. */
const LIFELINE_LEFT = ['left-[12.5%]', 'left-[37.5%]', 'left-[62.5%]', 'left-[87.5%]']

/** One arrow between two lifelines, or a dot when an actor works on its own. Each message is its own row. */
function MessageRow({ message }: { message: Message }) {
  const from = ACTORS.indexOf(message.from)
  const to = ACTORS.indexOf(message.to)

  if (from === to) {
    const columns = ACTORS.length - from
    return (
      <div class="grid grid-cols-4">
        <div class={`relative ${COL_START[from]} ${COL_SPAN[columns]}`}>
          <span
            class={`absolute top-1 size-3 -translate-x-1/2 rounded-full border-2 border-raised bg-brand ${DOT_LEFT[columns]}`}
          />
          <p class={`${labelClass} ${LABEL_INDENT[columns]}`}>{message.label}</p>
        </div>
      </div>
    )
  }

  const columns = Math.abs(to - from) + 1
  const rightwards = to > from
  return (
    <div class="grid grid-cols-4">
      <div class={`relative pb-3 ${COL_START[Math.min(from, to)]} ${COL_SPAN[columns]}`}>
        <p class={`px-1 text-center ${labelClass}`}>
          <span class="bg-raised box-decoration-clone px-1">{message.label}</span>
        </p>
        <span class={`absolute bottom-0 h-0.5 bg-brand ${ARROW_INSET[columns]}`}>
          <svg
            aria-hidden="true"
            viewBox="0 0 10 10"
            class={`absolute -top-1 size-2.5 text-brand ${rightwards ? '-right-0.5' : '-left-0.5 rotate-180'}`}
          >
            <path d="M0 0 10 5 0 10Z" fill="currentColor" />
          </svg>
        </span>
      </div>
    </div>
  )
}

/** The four parties and, for the current step, who sends what to whom. */
export function ActorDiagram({ step }: { step: Step }) {
  const { messages } = stepCopy[step]
  const involved = new Set(messages.flatMap((message) => [message.from, message.to]))

  return (
    <figure class="grid gap-4 rounded-xl border border-line bg-raised p-3 sm:p-5">
      <figcaption class="text-step--1 font-semibold">Quién envía qué en este paso</figcaption>

      <div aria-hidden="true" class="grid gap-3">
        <div class="grid grid-cols-4">
          {ACTORS.map((actor) => {
            const Icon = icons[actor]
            const on = involved.has(actor)
            return (
              <div key={actor} class="flex flex-col items-center gap-1.5 text-center">
                <span
                  class={`grid size-10 place-items-center rounded-lg border transition-colors ${
                    on ? 'border-brand bg-brand text-brand-contrast' : 'border-line text-muted'
                  }`}
                >
                  <Icon class="size-5" />
                </span>
                <span class={`${labelClass} ${on ? 'font-semibold text-text' : 'text-muted'}`}>
                  {actorNames[actor].short}
                </span>
              </div>
            )
          })}
        </div>

        <div class="relative grid gap-y-5 py-2">
          {ACTORS.map((actor, index) => (
            <span
              key={actor}
              class={`absolute inset-y-0 w-px ${LIFELINE_LEFT[index]} ${involved.has(actor) ? 'bg-brand' : 'bg-line'}`}
            />
          ))}
          {messages.map((message, index) => (
            <MessageRow key={`${step}-${index}`} message={message} />
          ))}
        </div>
      </div>

      <ol class="sr-only">
        {messages.map((message) => (
          <li key={message.label}>{describeMessage(message)}</li>
        ))}
      </ol>
    </figure>
  )
}
