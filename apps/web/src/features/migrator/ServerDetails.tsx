import type { MigrationMeta } from '@aim/contracts/migrator'
import type { ComponentChildren } from 'preact'
import { useId } from 'preact/hooks'
import { formatDuration } from '../api-playground/response'
import { inputClass } from '../forms/fields'
import { formatBytes } from './file'
import { encodingText, formatText } from './server'

interface Props {
  meta: MigrationMeta
  /** From sending the file to having the answer, as the browser measured it (upload included). */
  browserMs: number | null
  busy: boolean
  /** Processes the same workbook again with another sheet. */
  onSheet: (sheet: string) => void
}

/** What only the Python engine reports: how it read the file, which sheet, and how long it took. */
export function ServerDetails({ meta, browserMs, busy, onSheet }: Props) {
  const headingId = useId()
  const sheetId = useId()
  const sheetHint = useId()
  const { source, timings, engine } = meta

  const item = (label: string, value: ComponentChildren) => (
    <div class="grid gap-0.5">
      <dt class="text-step--1 text-muted">{label}</dt>
      <dd class="wrap-anywhere">{value}</dd>
    </div>
  )

  return (
    <section
      aria-labelledby={headingId}
      class="grid gap-4 rounded-xl border border-line bg-raised p-4 sm:p-5"
      data-testid="server-details"
    >
      <h3 id={headingId} class="text-step-1 font-semibold">
        Cómo lo leyó el servidor
      </h3>
      <dl class="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-x-6 gap-y-4">
        {item('Archivo', `${source.name} (${formatBytes(source.bytes)})`)}
        {item('Formato', formatText(source))}
        {source.encoding && item('Codificación', encodingText(source.encoding))}
        {source.sheet !== null && source.sheets.length <= 1 && item('Hoja', source.sheet)}
        {item(
          'Tiempo en el servidor',
          `${formatDuration(timings.totalMs)} (lectura ${formatDuration(timings.readMs)}, proceso ${formatDuration(timings.processMs)})`,
        )}
        {browserMs !== null && item('Tiempo total, con la subida', formatDuration(browserMs))}
        {item('Motor', `Python ${engine.python} y FastAPI (py-lab ${engine.version})`)}
      </dl>
      {source.sheet !== null && source.sheets.length > 1 && (
        <div class="grid max-w-md gap-1">
          <label for={sheetId} class="font-semibold">
            Hoja del libro
          </label>
          <select
            id={sheetId}
            class={`${inputClass} disabled:cursor-wait disabled:opacity-70`}
            value={source.sheet}
            disabled={busy}
            aria-describedby={sheetHint}
            onChange={(event) => onSheet((event.currentTarget as HTMLSelectElement).value)}
          >
            {source.sheets.map((sheet) => (
              <option key={sheet} value={sheet}>
                {sheet}
              </option>
            ))}
          </select>
          <p id={sheetHint} class="text-step--1 text-muted">
            El libro tiene {source.sheets.length} hojas. Al elegir otra, el archivo se procesa de nuevo.
          </p>
        </div>
      )}
    </section>
  )
}
