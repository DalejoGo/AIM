import { useId } from 'preact/hooks'
import { formatCount } from './file'
import { cellText } from './format'
import { pickShowcaseRow } from './pipeline'
import { data, ScrollTable, td, th } from './ScrollTable'
import type { MigrationResult } from './types'

/** A cell value as it came in the file. The tinted box shows where it starts and ends, stray spaces included. */
export function RawValue({ value }: { value: string | undefined }) {
  if (!value) return <span class="text-muted">vacía</span>
  return <span class={`${data} rounded bg-line/60 px-0.5`}>{value}</span>
}

export function BeforeAfter({ result }: { result: MigrationResult }) {
  const headingId = useId()
  const fromValid = pickShowcaseRow(result.valid)
  const row = fromValid ?? pickShowcaseRow(result.invalid)
  if (!row) return null
  const n = formatCount(row.rowNumber)

  return (
    <section aria-labelledby={headingId} class="grid grid-cols-[minmax(0,1fr)] gap-4">
      <h2 id={headingId} class="text-step-2 font-semibold">
        Antes y después de una fila
      </h2>
      <p class="prose-measure text-muted">
        {fromValid
          ? `Es la fila ${n} de tu archivo, la que más cambió entre las válidas.`
          : `Es la fila ${n} de tu archivo. Ninguna fila pasó la validación, así que esta muestra lo que se alcanzó a normalizar.`}{' '}
        En «Antes» el fondo marca dónde empieza y termina cada valor, para que se vean los espacios de más.
      </p>
      <ScrollTable caption={`Fila ${n}, antes y después de normalizar`}>
        <thead>
          <tr>
            <th scope="col" class={th}>
              Columna
            </th>
            <th scope="col" class={th}>
              Antes
            </th>
            <th scope="col" class={th}>
              Después
            </th>
          </tr>
        </thead>
        <tbody>
          {result.columns.map((column) => {
            const changed = row.changed.includes(column.key)
            const after = cellText(row.clean[column.key] ?? null)
            return (
              <tr key={column.key}>
                <th scope="row" class={`${td} font-semibold`}>
                  {column.label || column.key}
                </th>
                <td class={td}>
                  <RawValue value={row.raw[column.key]} />
                </td>
                <td class={`${td} ${changed ? 'font-semibold text-text' : 'text-muted'}`}>
                  {after ? <span class={data}>{after}</span> : <span>vacía</span>}
                  {!changed && <span class="sr-only"> (sin cambios)</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </ScrollTable>
    </section>
  )
}
