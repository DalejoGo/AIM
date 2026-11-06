import { useSignal } from '@preact/signals'
import { CircleAlert, CircleCheck } from 'lucide-preact'
import { useId, useRef } from 'preact/hooks'
import { formatCount } from './file'
import { cellText, typeLabel } from './format'
import { data, ScrollTable, td, th } from './ScrollTable'
import type { Column, MigrationResult, ProcessedRow } from './types'

/** Rows shown in each tab; the downloads carry all of them. */
export const PREVIEW_ROWS = 50

type TabId = 'valid' | 'invalid'

/** Tabs follow the WAI-ARIA pattern: arrow keys, Home and End move between them. */
export function PreviewTabs({ result }: { result: MigrationResult }) {
  const baseId = useId()
  const headingId = `${baseId}-heading`
  const active = useSignal<TabId>(
    result.valid.length === 0 && result.invalid.length > 0 ? 'invalid' : 'valid',
  )
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'valid', label: 'Válidas', count: result.valid.length },
    { id: 'invalid', label: 'Con errores', count: result.invalid.length },
  ]

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: -1 }
    const move = moves[event.key]
    if (move === undefined) return
    const next = (move + tabs.length) % tabs.length
    event.preventDefault()
    const tab = tabs[next]
    if (tab) active.value = tab.id
    buttons.current[next]?.focus()
  }

  return (
    <section aria-labelledby={headingId} class="grid grid-cols-[minmax(0,1fr)] gap-4">
      <h2 id={headingId} class="text-step-2 font-semibold">
        Vista previa
      </h2>
      <div role="tablist" aria-labelledby={headingId} class="flex flex-wrap gap-x-2 border-b border-line">
        {tabs.map((tab, index) => {
          const selected = active.value === tab.id
          return (
            <button
              key={tab.id}
              ref={(element) => {
                buttons.current[index] = element
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              class={`-mb-px border-b-2 px-3 py-2 font-semibold transition-colors ${
                selected ? 'border-brand text-text' : 'border-transparent text-muted hover:text-text'
              }`}
              onClick={() => {
                active.value = tab.id
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {tab.label} ({formatCount(tab.count)})
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-valid`}
        aria-labelledby={`${baseId}-tab-valid`}
        hidden={active.value !== 'valid'}
      >
        <ValidTable result={result} />
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-invalid`}
        aria-labelledby={`${baseId}-tab-invalid`}
        hidden={active.value !== 'invalid'}
      >
        <InvalidTable result={result} />
      </div>
    </section>
  )
}

function shownOf(total: number, what: string): string {
  return total > PREVIEW_ROWS
    ? `Se muestran las primeras ${formatCount(PREVIEW_ROWS)} de ${formatCount(total)}; la descarga trae todas.`
    : `${what}: ${formatCount(total)}.`
}

function ColumnHeader({ column }: { column: Column }) {
  return (
    <th scope="col" class={`${th} whitespace-nowrap`}>
      <span class="block">{column.label || column.key}</span>
      <span class="block font-normal text-muted">{typeLabel(column)}</span>
    </th>
  )
}

function Empty() {
  return (
    <>
      <span aria-hidden="true" class="text-muted">
        —
      </span>
      <span class="sr-only">vacía</span>
    </>
  )
}

function ValidTable({ result }: { result: MigrationResult }) {
  if (result.valid.length === 0) {
    return (
      <p class="prose-measure text-muted">
        Ninguna fila pasó la validación. En la pestaña «Con errores» está qué corregir en cada una.
      </p>
    )
  }
  return (
    <ScrollTable caption={`Filas válidas, ya normalizadas. ${shownOf(result.valid.length, 'En total')}`}>
      <thead>
        <tr>
          <th scope="col" class={`${th} whitespace-nowrap`}>
            Fila
          </th>
          {result.columns.map((column) => (
            <ColumnHeader key={column.key} column={column} />
          ))}
        </tr>
      </thead>
      <tbody>
        {result.valid.slice(0, PREVIEW_ROWS).map((row) => (
          <tr key={row.rowNumber}>
            <th scope="row" class={`${td} font-normal text-muted`}>
              {formatCount(row.rowNumber)}
            </th>
            {result.columns.map((column) => {
              const value = cellText(row.clean[column.key] ?? null)
              return (
                <td key={column.key} class={`${td} ${data}`}>
                  {value || <Empty />}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  )
}

function InvalidTable({ result }: { result: MigrationResult }) {
  if (result.invalid.length === 0) {
    return (
      <p class="flex items-center gap-2">
        <CircleCheck class="shrink-0 text-live" size={20} aria-hidden="true" />
        Ninguna fila tiene errores.
      </p>
    )
  }
  return (
    <ScrollTable
      caption={`Filas con errores: qué corregir y los valores tal como vienen en tu archivo. ${shownOf(result.invalid.length, 'En total')}`}
    >
      <thead>
        <tr>
          <th scope="col" class={`${th} whitespace-nowrap`}>
            Fila
          </th>
          <th scope="col" class={`${th} min-w-64 sm:min-w-80`}>
            Qué corregir
          </th>
          {result.columns.map((column) => (
            <ColumnHeader key={column.key} column={column} />
          ))}
        </tr>
      </thead>
      <tbody>
        {result.invalid.slice(0, PREVIEW_ROWS).map((row) => (
          <InvalidRow key={row.rowNumber} columns={result.columns} row={row} />
        ))}
      </tbody>
    </ScrollTable>
  )
}

function InvalidRow({ columns, row }: { columns: Column[]; row: ProcessedRow }) {
  const failing = new Set(row.errors.map((error) => error.key))
  return (
    <tr>
      <th scope="row" class={`${td} font-normal text-muted`}>
        {formatCount(row.rowNumber)}
      </th>
      <td class={td}>
        <ul class="grid gap-1.5">
          {row.errors.map((error) => (
            <li key={error.key || 'row'}>
              <span class="font-semibold">{error.label}:</span> {error.message}
            </li>
          ))}
        </ul>
      </td>
      {columns.map((column) => {
        const value = row.raw[column.key] ?? ''
        const bad = failing.has(column.key)
        return (
          <td key={column.key} class={`${td} ${bad ? 'font-semibold text-danger' : ''}`}>
            <span class="inline-flex items-center gap-1.5">
              {bad && <CircleAlert class="shrink-0" size={16} aria-hidden="true" />}
              {value.trim() ? <span class={data}>{value}</span> : <Empty />}
              {bad && <span class="sr-only"> (con error)</span>}
            </span>
          </td>
        )
      })}
    </tr>
  )
}
