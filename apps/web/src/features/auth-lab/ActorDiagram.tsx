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

/** Centre of the first column of a span of `columns`, as a percentage of the span's width. */
const firstCentre = (columns: number) => `${50 / columns}%`

/** One arrow between two lifelines, or a dot when an actor works on its own. */
function MessageRow({ message, row }: { message: Message; row: number }) {
  const from = ACTORS.indexOf(message.from)
  const to = ACTORS.indexOf(message.to)

  if (from === to) {
    const columns = ACTORS.length - from
    return (
      <div class="relative" style={{ gridColumn: `${from + 1} / -1`, gridRow: row }}>
        <span
          class="absolute top-1 size-3 -translate-x-1/2 rounded-full border-2 border-raised bg-brand"
          style={{ left: firstCentre(columns) }}
        />
        <p class={labelClass} style={{ paddingLeft: `calc(${firstCentre(columns)} + 0.75rem)` }}>
          {message.label}
        </p>
      </div>
    )
  }

  const columns = Math.abs(to - from) + 1
  const inset = firstCentre(columns)
  const rightwards = to > from
  return (
    <div
      class="relative pb-3"
      style={{ gridColumn: `${Math.min(from, to) + 1} / span ${columns}`, gridRow: row }}
    >
      <p class={`px-1 text-center ${labelClass}`}>
        <span class="bg-raised box-decoration-clone px-1">{message.label}</span>
      </p>
      <span class="absolute bottom-0 h-0.5 bg-brand" style={{ left: inset, right: inset }}>
        <svg
          aria-hidden="true"
          viewBox="0 0 10 10"
          class={`absolute -top-1 size-2.5 text-brand ${rightwards ? '-right-0.5' : '-left-0.5 rotate-180'}`}
        >
          <path d="M0 0 10 5 0 10Z" fill="currentColor" />
        </svg>
      </span>
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

        <div class="relative grid grid-cols-4 gap-y-5 py-2">
          {ACTORS.map((actor, index) => (
            <span
              key={actor}
              class={`absolute inset-y-0 w-px ${involved.has(actor) ? 'bg-brand' : 'bg-line'}`}
              style={{ left: `${12.5 + 25 * index}%` }}
            />
          ))}
          {messages.map((message, index) => (
            <MessageRow key={`${step}-${index}`} message={message} row={index + 1} />
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
