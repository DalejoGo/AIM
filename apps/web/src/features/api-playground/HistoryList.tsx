import type { Exchange } from './history'
import { HISTORY_SIZE } from './history'
import { formatDuration } from './response'
import { isSuccess, OutcomeIcon, outcomeLabel } from './ui'

export const HISTORY_HEADING = 'playground-history'

const clockTime = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

interface HistoryListProps {
  history: readonly Exchange[]
  selectedId: string | null
  onSelect: (exchange: Exchange) => void
}

/** "Historial": the session's last requests; picking one shows its answer again and refills the request. */
export function HistoryList({ history, selectedId, onSelect }: HistoryListProps) {
  return (
    <section aria-labelledby={HISTORY_HEADING} class="grid min-w-0 gap-4">
      <div class="grid gap-1">
        <h2 id={HISTORY_HEADING} class="text-step-2 font-semibold">
          Historial
        </h2>
        <p class="text-step--1 text-muted">
          Tus últimas {HISTORY_SIZE} peticiones en esta pestaña. Elige una para ver otra vez su respuesta.
        </p>
      </div>
      {history.length === 0 ? (
        <p class="text-muted">Todavía no has enviado ninguna petición.</p>
      ) : (
        <ol class="grid gap-2">
          {history.map((exchange) => {
            const selected = exchange.id === selectedId
            const { outcome, request } = exchange
            return (
              <li key={exchange.id}>
                <button
                  type="button"
                  aria-current={selected ? 'true' : undefined}
                  class="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2 text-left transition-colors hover:border-brand aria-[current=true]:border-brand aria-[current=true]:bg-raised sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                  onClick={() => onSelect(exchange)}
                >
                  <OutcomeIcon outcome={outcome} />
                  <span class="min-w-0 truncate font-mono text-step--1">
                    {request.method} {request.path}
                  </span>{' '}
                  <span
                    class={`col-start-2 flex flex-wrap gap-x-3 text-step--1 sm:col-start-3 sm:justify-end ${isSuccess(outcome) ? '' : 'text-danger'}`}
                  >
                    <span class="font-semibold">{outcomeLabel(outcome)}</span>{' '}
                    <span class="text-muted tabular-nums">{formatDuration(outcome.totalMs)}</span>{' '}
                    <span class="text-muted tabular-nums">{clockTime.format(exchange.at)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
