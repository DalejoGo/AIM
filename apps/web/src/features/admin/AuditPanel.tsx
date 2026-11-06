import type { AuditEntry } from '@aim/contracts'
import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { ApiRequestError, api, isSessionExpired, messageForStatus } from '../../lib/api'
import { focusSoon, Spinner } from '../forms/fields'
import { ScrollRegion } from '../migrator/ScrollTable'
import { actionLabel, countLabel, formatDateTime, OUTCOME_LABELS } from './format'

const th = 'border-b border-line px-3 py-2 align-bottom font-semibold'
const td = 'border-b border-line px-3 py-2 align-top'

/** The access log (DEC-017), newest first, paginated by cursor. */
export function AuditPanel({ onSessionEnd }: { onSessionEnd: () => void }) {
  const items = useSignal<AuditEntry[]>([])
  const cursor = useSignal<string | null>(null)
  const loading = useSignal<'first' | 'more' | null>('first')
  const loadError = useSignal<string | null>(null)
  const request = useRef(0)

  async function load(reset: boolean) {
    const current = ++request.current
    loading.value = reset ? 'first' : 'more'
    loadError.value = null
    try {
      const page = await api.listAudit(reset ? undefined : (cursor.value ?? undefined))
      if (current !== request.current) return
      items.value = reset ? page.items : [...items.value, ...page.items]
      cursor.value = page.nextCursor
      const first = page.items[0]
      if (!reset && first) focusSoon(`audit-${first.id}`)
    } catch (error) {
      if (current !== request.current) return
      if (isSessionExpired(error)) return onSessionEnd()
      loadError.value = error instanceof ApiRequestError ? error.message : messageForStatus(0)
    } finally {
      if (current === request.current) loading.value = null
    }
  }

  useEffect(() => {
    load(true)
  }, [])

  const list = items.value
  return (
    <div class="grid min-w-0 gap-6">
      <p role="status" aria-live="polite" class="min-h-[1.6em] text-step--1 text-muted">
        {loading.value === 'first'
          ? 'Cargando accesos…'
          : loadError.value === null
            ? `${countLabel(list.length, 'registro', 'registros')}${cursor.value ? ' cargados; hay más' : ''}.`
            : ''}
      </p>

      {loadError.value && (
        <div role="alert" class="grid gap-3 rounded-lg border border-danger p-4">
          <p>{loadError.value}</p>
          <div>
            <button type="button" class="btn btn-quiet" onClick={() => load(list.length === 0)}>
              Intentar de nuevo
            </button>
          </div>
        </div>
      )}

      {loading.value !== 'first' && list.length === 0 && !loadError.value && (
        <p class="rounded-xl border border-dashed border-line p-6 text-muted">
          Todavía no hay accesos registrados.
        </p>
      )}

      {list.length > 0 && (
        <ScrollRegion labelledBy="audit-caption">
          <table class="w-full border-collapse text-left text-step--1">
            <caption id="audit-caption" class="sr-only">
              Registro de accesos, del más reciente al más antiguo
            </caption>
            <thead>
              <tr>
                <th scope="col" class={th}>
                  Fecha
                </th>
                <th scope="col" class={th}>
                  Quién
                </th>
                <th scope="col" class={th}>
                  Acción
                </th>
                <th scope="col" class={th}>
                  Resultado
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((entry) => (
                <tr key={entry.id}>
                  <th
                    scope="row"
                    id={`audit-${entry.id}`}
                    tabIndex={-1}
                    class={`${td} whitespace-nowrap font-normal text-muted`}
                  >
                    <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>
                  </th>
                  <td class={`${td} [overflow-wrap:anywhere]`}>{entry.actor ?? 'Sin identificar'}</td>
                  <td class={td}>{actionLabel(entry.action)}</td>
                  <td class={`${td} ${entry.outcome === 'ok' ? '' : 'font-semibold text-danger'}`}>
                    {OUTCOME_LABELS[entry.outcome]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}

      {cursor.value && (
        <div>
          <button
            type="button"
            class="btn btn-quiet aria-disabled:cursor-wait"
            aria-disabled={loading.value === 'more'}
            onClick={() => {
              if (loading.value === null) load(false)
            }}
          >
            {loading.value === 'more' && <Spinner />}
            {loading.value === 'more' ? 'Cargando…' : 'Cargar más'}
          </button>
        </div>
      )}
    </div>
  )
}
