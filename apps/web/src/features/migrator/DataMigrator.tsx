import { useSignal } from '@preact/signals'
import { CircleAlert, FileSpreadsheet, LoaderCircle, ShieldCheck } from 'lucide-preact'
import { useId } from 'preact/hooks'
import { BeforeAfter } from './BeforeAfter'
import { Downloads } from './Downloads'
import { DropZone } from './DropZone'
import { checkFile, decodeCsv } from './file'
import { summarySentence } from './format'
import { PipelineSteps, type Source } from './PipelineSteps'
import { PreviewTabs } from './PreviewTabs'
import { runMigration } from './pipeline'
import { ScrollRegion } from './ScrollTable'
import { SAMPLE_CSV, SAMPLE_NAME } from './sample'
import type { MigrationResult } from './types'

const READ_ERROR =
  'No se pudo leer el archivo. Vuelve a elegirlo; si sigue fallando, ábrelo y guárdalo de nuevo como CSV.'

/**
 * Lets the "processing" message paint before the synchronous pipeline takes the main thread. Browsers pause
 * animation frames in tabs that are not painting, so a short timeout guarantees it never waits longer.
 */
const nextPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0))
    setTimeout(resolve, 100)
  })

/** Lab demo: upload a messy CSV and watch it get read, typed, normalised, validated and split. All in the browser. */
export function DataMigrator() {
  const working = useSignal(false)
  const status = useSignal('')
  const error = useSignal<string | null>(null)
  const source = useSignal<Source | null>(null)
  const result = useSignal<MigrationResult | null>(null)
  /** Bumped on every new result so the preview starts again on its first tab. */
  const run = useSignal(0)
  const inputHeading = useId()
  const stepsHeading = useId()

  const fail = (message: string) => {
    working.value = false
    error.value = message
    result.value = null
    source.value = null
    status.value = ''
  }

  const processText = async (text: string, name: string, size: number) => {
    working.value = true
    error.value = null
    status.value = `Procesando «${name}»…`
    await nextPaint()
    const outcome = runMigration(text)
    if (!outcome.ok) {
      fail(outcome.error)
      return
    }
    source.value = { name, size }
    result.value = outcome.result
    run.value += 1
    working.value = false
    status.value = `Listo. ${summarySentence(outcome.result)}`
  }

  const handleFile = async (file: File) => {
    const problem = checkFile(file.name, file.size, file.type)
    if (problem) {
      fail(problem)
      return
    }
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await file.arrayBuffer())
    } catch {
      fail(READ_ERROR)
      return
    }
    const decoded = decodeCsv(bytes)
    if (!decoded.ok) {
      fail(decoded.error)
      return
    }
    await processText(decoded.text, file.name, file.size)
  }

  const trySample = () => {
    void processText(SAMPLE_CSV, SAMPLE_NAME, new TextEncoder().encode(SAMPLE_CSV).length)
  }

  const current = result.value
  const currentSource = source.value

  return (
    <div class="grid grid-cols-[minmax(0,1fr)] gap-16">
      <section
        aria-labelledby={inputHeading}
        class="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12"
      >
        <div class="grid grid-cols-[minmax(0,1fr)] content-start gap-4">
          <h2 id={inputHeading} class="text-step-2 font-semibold">
            Sube tu archivo
          </h2>
          <DropZone disabled={working.value} onFile={handleFile} />
          <div>
            <button
              type="button"
              class="btn btn-quiet w-full disabled:cursor-wait disabled:opacity-70 sm:w-auto"
              disabled={working.value}
              onClick={trySample}
            >
              <FileSpreadsheet class="shrink-0" size={18} aria-hidden="true" />
              Probar con un archivo de ejemplo
            </button>
          </div>
          <details class="text-step--1">
            <summary class="w-fit cursor-pointer text-muted underline decoration-line underline-offset-4 hover:text-text hover:decoration-brand">
              Ver cómo viene el archivo de ejemplo
            </summary>
            <ScrollRegion label="Contenido del archivo de ejemplo" class="mt-3 max-h-80">
              <pre class="w-max p-4 font-mono leading-relaxed">{SAMPLE_CSV}</pre>
            </ScrollRegion>
          </details>
          <p role="status" class="flex min-h-7 items-center gap-2 text-step--1">
            {working.value && (
              <LoaderCircle class="shrink-0 motion-safe:animate-spin" size={18} aria-hidden="true" />
            )}
            {status.value}
          </p>
          {error.value && (
            <div
              role="alert"
              class="flex items-start gap-3 rounded-xl border border-danger bg-raised p-4 text-danger"
            >
              <CircleAlert class="mt-1 shrink-0" size={20} aria-hidden="true" />
              <p>{error.value}</p>
            </div>
          )}
        </div>
        <aside aria-label="Privacidad" class="grid content-start gap-2 lg:border-l lg:border-line lg:pl-6">
          <ShieldCheck class="text-brand" size={28} aria-hidden="true" />
          <p class="font-semibold">Tu archivo nunca sale de tu navegador.</p>
          <p class="text-muted">
            Se lee y se procesa aquí mismo, en tu dispositivo. No se envía a ningún servidor ni se guarda: al
            cerrar la pestaña, desaparece.
          </p>
        </aside>
      </section>

      <section
        aria-labelledby={stepsHeading}
        aria-busy={working.value}
        class="grid grid-cols-[minmax(0,1fr)] gap-8"
      >
        <div class="grid gap-2">
          <h2 id={stepsHeading} class="text-step-2 font-semibold">
            {current ? 'Qué pasó con tu archivo' : 'Qué va a pasar con tu archivo'}
          </h2>
          {!current && (
            <p class="prose-measure text-muted">
              Son cinco pasos, en este orden. Sube un archivo o prueba con el de ejemplo para ver qué hizo
              cada uno.
            </p>
          )}
        </div>
        <PipelineSteps result={current} source={currentSource} />
      </section>

      {current && currentSource && (
        <>
          <BeforeAfter result={current} />
          <PreviewTabs key={run.value} result={current} />
          <Downloads
            result={current}
            sourceName={currentSource.name}
            onDownloaded={(fileName) => {
              status.value = `Se descargó «${fileName}».`
            }}
          />
        </>
      )}
    </div>
  )
}
