import type { MigrationSource } from '@aim/contracts/migrator'
import type { ComponentChildren } from 'preact'
import { formatBytes, formatCount } from './file'
import {
  changeLines,
  delimiterName,
  plural,
  reasonText,
  SAMPLE_NOTE,
  summarySentence,
  typeLabel,
} from './format'
import { data, ScrollTable, td, th } from './ScrollTable'
import { type Engine, encodingText, isWorkbook } from './server'
import type { MigrationResult } from './types'

export interface Source {
  name: string
  size: number
}

interface Props {
  result: MigrationResult | null
  source: Source | null
  /** Which engine runs (or ran) the steps. Default: the browser. */
  engine?: Engine
  /** What the Python engine reported about the file it read. */
  server?: MigrationSource | null
}

/** Step 1 of the Python engine, once it ran: format, sheet or encoding, rows and separator. */
function serverReadReport(result: MigrationResult, source: Source, server: MigrationSource) {
  const how = isWorkbook(server)
    ? `la hoja «${server.sheet ?? ''}» del libro de Excel`
    : `el texto como ${encodingText(server.encoding ?? { name: 'utf-8', detectedBy: 'utf-8' })}`
  const separator = isWorkbook(server) ? '' : `, separadas por ${delimiterName(result.delimiter)}`
  return (
    <p>
      Python leyó «{source.name}» ({formatBytes(source.size)}) en memoria, sin guardarlo: {how}. Encontró una
      fila de encabezados y {plural(result.totalRows, 'fila de datos', 'filas de datos')}
      {separator}.{' '}
      {result.emptyRows.length > 0 &&
        `${plural(result.emptyRows.length, 'fila estaba vacía y se descartó', 'filas estaban vacías y se descartaron')}.`}
    </p>
  )
}

interface Step {
  title: string
  /** What the step does, shown before there is a file. */
  plan: string
  /** What it did with this file. */
  report?: ComponentChildren
  count?: { value: number; unit: string }
}

/** The pipeline as a numbered sequence: what each step does and, once a file ran, what it did and how many. */
export function PipelineSteps({ result, source, engine = 'browser', server = null }: Props) {
  const python = engine === 'server'
  const steps: Step[] = [
    {
      title: 'Leer el archivo',
      plan: python
        ? 'Python recibe el archivo y lo lee en memoria: reconoce por su contenido si es CSV o Excel, detecta la codificación del texto y el separador (coma o punto y coma), y toma la primera fila como encabezados.'
        : 'PapaParse lee el CSV, detecta si el separador es coma o punto y coma y toma la primera fila como encabezados.',
      ...(result &&
        source && {
          report: server ? (
            serverReadReport(result, source, server)
          ) : (
            <p>
              PapaParse leyó «{source.name}» ({formatBytes(source.size)}): una fila de encabezados y{' '}
              {plural(result.totalRows, 'fila de datos', 'filas de datos')}, separadas por{' '}
              {delimiterName(result.delimiter)}.{' '}
              {result.emptyRows.length > 0 &&
                `${plural(result.emptyRows.length, 'fila estaba vacía y se descartó', 'filas estaban vacías y se descartaron')}.`}
            </p>
          ),
          count: { value: result.totalRows, unit: result.totalRows === 1 ? 'fila leída' : 'filas leídas' },
        }),
    },
    {
      title: 'Detectar columnas',
      plan: `Pasa los encabezados a nombres sin tildes ni espacios y revisa ${SAMPLE_NOTE} para saber si cada una tiene correos, teléfonos, fechas, montos o texto.`,
      ...(result && {
        report: (
          <>
            <p>
              Cada encabezado quedó como un nombre sin tildes ni espacios, y el tipo salió de revisar{' '}
              {SAMPLE_NOTE}.
            </p>
            <div class="mt-4">
              <ScrollTable caption="Columnas detectadas">
                <thead>
                  <tr>
                    <th scope="col" class={th}>
                      En tu archivo
                    </th>
                    <th scope="col" class={th}>
                      Queda como
                    </th>
                    <th scope="col" class={th}>
                      Tipo
                    </th>
                    <th scope="col" class={`${th} min-w-64`}>
                      Por qué
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.columns.map((column) => (
                    <tr key={column.key}>
                      <th scope="row" class={`${td} font-semibold`}>
                        {column.label || <span class="text-muted">Sin nombre</span>}
                      </th>
                      <td class={`${td} ${data}`}>{column.key}</td>
                      <td class={`${td} whitespace-nowrap`}>{typeLabel(column)}</td>
                      <td class={`${td} text-muted`}>{reasonText(column)}</td>
                    </tr>
                  ))}
                </tbody>
              </ScrollTable>
            </div>
          </>
        ),
        count: { value: result.columns.length, unit: result.columns.length === 1 ? 'columna' : 'columnas' },
      }),
    },
    {
      title: 'Normalizar',
      plan: 'Quita espacios de más, escribe los nombres en formato título y los correos en minúscula, pasa los teléfonos a formato internacional (+57 si son 10 dígitos que empiezan por 3), las fechas a año-mes-día leyendo primero el día, y los montos a número.',
      ...(result && {
        report: (
          <>
            <p>
              {result.changedCells === 0
                ? 'Ningún valor necesitó cambios.'
                : `Se ajustaron ${plural(result.changedCells, 'valor', 'valores')}:`}
            </p>
            {result.changedCells > 0 && (
              <ul class="mt-2 grid gap-1 pl-5 list-disc">
                {changeLines(result).map((line) => (
                  <li key={line.label}>
                    {formatCount(line.count)} {line.label}
                  </li>
                ))}
              </ul>
            )}
            <p class="mt-3">
              {result.duplicates.length === 0
                ? 'Con los valores ya normalizados no quedó ninguna fila repetida.'
                : `Con los valores ya normalizados, ${plural(result.duplicates.length, 'fila quedó igual a otra anterior y se quitó', 'filas quedaron iguales a otra anterior y se quitaron')}.`}
            </p>
          </>
        ),
        count: {
          value: result.changedCells,
          unit: result.changedCells === 1 ? 'valor ajustado' : 'valores ajustados',
        },
      }),
    },
    {
      title: 'Validar',
      plan: python
        ? 'Revisa cada fila con las mismas reglas que Zod aplica en el navegador: correo válido, teléfono internacional, fecha que exista y monto numérico. Las celdas vacías se permiten.'
        : 'Arma un esquema de Zod con los tipos detectados y revisa cada fila: correo válido, teléfono internacional, fecha que exista y monto numérico. Las celdas vacías se permiten.',
      ...(result && {
        report: (
          <p>
            {python ? 'Python' : 'Zod'} revisó{' '}
            {plural(result.valid.length + result.invalid.length, 'fila', 'filas')}{' '}
            {python ? 'con las mismas reglas del navegador' : 'con un esquema armado para este archivo'}:
            correo válido, teléfono internacional, fecha que exista y monto numérico, según el tipo de cada
            columna. Las celdas vacías se permiten.{' '}
            {result.invalid.length === 0
              ? 'Todas pasaron.'
              : `${plural(result.invalid.length, 'fila tiene', 'filas tienen')} al menos un error, con el motivo por campo.`}
          </p>
        ),
        count: {
          value: result.valid.length + result.invalid.length,
          unit: result.valid.length + result.invalid.length === 1 ? 'fila revisada' : 'filas revisadas',
        },
      }),
    },
    {
      title: 'Resultado',
      plan: 'Separa las filas válidas de las que tienen errores y cuenta los duplicados y las filas vacías que quedaron por fuera.',
      ...(result && { report: <Outcome result={result} /> }),
    },
  ]

  return (
    <ol class="grid grid-cols-[minmax(0,1fr)] gap-10">
      {steps.map((step, i) => {
        const done = step.report !== undefined
        const last = i === steps.length - 1
        return (
          <li key={step.title} class="relative grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4">
            {!last && (
              <span
                aria-hidden="true"
                class="absolute top-12 bottom-[-2rem] left-5 w-px -translate-x-1/2 bg-line"
              />
            )}
            <span
              aria-hidden="true"
              class={`grid size-10 place-items-center rounded-full font-display font-semibold ${
                done ? 'bg-brand text-brand-contrast' : 'border border-line bg-ink text-muted'
              }`}
            >
              {i + 1}
            </span>
            <div class="grid grid-cols-[minmax(0,1fr)] gap-2 pt-1.5">
              <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <h3 class="text-step-1 font-semibold">
                  <span class="sr-only">Paso {i + 1}: </span>
                  {step.title}
                </h3>
                {step.count && (
                  <p class="text-step--1 text-muted">
                    <span class="font-display text-step-2 font-semibold text-text">
                      {formatCount(step.count.value)}
                    </span>{' '}
                    {step.count.unit}
                  </p>
                )}
              </div>
              {done ? (
                <div class="text-muted [&>p]:max-w-[68ch]">{step.report}</div>
              ) : (
                <p class="prose-measure text-muted">{step.plan}</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function Outcome({ result }: { result: MigrationResult }) {
  const stats = [
    { label: 'Válidas', value: result.valid.length, tone: 'text-live' },
    {
      label: 'Con errores',
      value: result.invalid.length,
      tone: result.invalid.length > 0 ? 'text-danger' : '',
    },
    { label: 'Duplicadas quitadas', value: result.duplicates.length, tone: '' },
    { label: 'Vacías descartadas', value: result.emptyRows.length, tone: '' },
  ]
  return (
    <div class="grid gap-4">
      <dl class="flex flex-wrap gap-x-10 gap-y-4">
        {stats.map((stat) => (
          <div key={stat.label} class="grid">
            <dt class="text-step--1 text-muted">{stat.label}</dt>
            <dd class={`font-display text-step-3 font-semibold ${stat.tone || 'text-text'}`}>
              {formatCount(stat.value)}
            </dd>
          </div>
        ))}
      </dl>
      <p class="prose-measure">{summarySentence(result)}</p>
      {result.duplicates.length > 0 && (
        <details class="group">
          <summary class="cursor-pointer text-text underline decoration-line underline-offset-4 hover:decoration-brand">
            Ver qué filas se repetían
          </summary>
          <ul class="mt-2 grid gap-1 pl-5 list-disc">
            {result.duplicates.map((duplicate) => (
              <li key={duplicate.rowNumber}>
                La fila {formatCount(duplicate.rowNumber)} repite la fila {formatCount(duplicate.duplicateOf)}
                .
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
