import { Download } from 'lucide-preact'
import { useId } from 'preact/hooks'
import { BOM, exportName, toCleanCsv, toErrorsCsv } from './export'
import { delimiterName, plural } from './format'
import type { MigrationResult } from './types'

interface Props {
  result: MigrationResult
  sourceName: string
  /** Called with the file name once the browser starts the download, to announce it. */
  onDownloaded: (fileName: string) => void
}

function saveCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // Some browsers start reading the blob after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function Downloads({ result, sourceName, onDownloaded }: Props) {
  const headingId = useId()
  const noteId = useId()

  const download = (suffix: string, csv: string) => {
    const fileName = exportName(sourceName, suffix)
    saveCsv(fileName, csv)
    onDownloaded(fileName)
  }

  return (
    <section aria-labelledby={headingId} class="grid grid-cols-[minmax(0,1fr)] gap-4">
      <h2 id={headingId} class="text-step-2 font-semibold">
        Descarga el resultado
      </h2>
      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          class="btn btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          disabled={result.valid.length === 0}
          aria-describedby={noteId}
          onClick={() => download('limpio', toCleanCsv(result))}
        >
          <Download class="shrink-0" size={18} aria-hidden="true" />
          Descargar datos limpios (CSV)
        </button>
        <button
          type="button"
          class="btn btn-quiet w-full disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          disabled={result.invalid.length === 0}
          aria-describedby={noteId}
          onClick={() => download('errores', toErrorsCsv(result))}
        >
          <Download class="shrink-0" size={18} aria-hidden="true" />
          Descargar errores (CSV)
        </button>
      </div>
      <div id={noteId} class="prose-measure grid gap-2 text-step--1 text-muted">
        <p>
          Los datos limpios traen {plural(result.valid.length, 'fila válida', 'filas válidas')} con los
          nombres de columna normalizados, separadas por {delimiterName(result.delimiter)} como tu archivo.
          Los montos van con punto decimal y sin separador de miles.
        </p>
        <p>
          El archivo de errores trae {plural(result.invalid.length, 'fila', 'filas')} tal como venían, con su
          número de fila y qué corregir, para que las arregles y vuelvas a subirlas.
        </p>
      </div>
    </section>
  )
}
