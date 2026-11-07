import type { MigrationMeta, PyLabLimits } from '@aim/contracts/migrator'
import { batch, useSignal } from '@preact/signals'
import { CircleAlert, FileSpreadsheet, LoaderCircle, ServerCog, ShieldCheck, X } from 'lucide-preact'
import { useEffect, useId, useRef } from 'preact/hooks'
import { formatDuration } from '../api-playground/response'
import { isWaking, mayBeAsleep, WAKE_HINT_AFTER_MS } from '../api-playground/wake'
import { DropZone } from './DropZone'
import { EngineChoice, type ServerStatus } from './EngineChoice'
import { checkFile, decodeCsv } from './file'
import { summarySentence } from './format'
import { PipelineSteps, type Source } from './PipelineSteps'
import { ScrollRegion } from './ScrollTable'
import { ServerDetails } from './ServerDetails'
import { SAMPLE_CSV, SAMPLE_NAME } from './sample'
import {
  checkServerFile,
  type Engine,
  isWorkbook,
  limitsText,
  SERVER_ACCEPT,
  SERVER_WAKING_TEXT,
  serverFailureText,
  serverWokeText,
} from './server'
import type { MigrationResult } from './types'

const READ_ERROR =
  'No se pudo leer el archivo. Vuelve a elegirlo; si sigue fallando, ábrelo y guárdalo de nuevo como CSV.'
const LOAD_ERROR = 'No se pudo cargar el procesador. Revisa tu conexión y vuelve a intentarlo.'

type ResultsModule = typeof import('./Results')
type ClientModule = typeof import('./serverClient')

/** Loads a module once; a failed load (offline, new deploy) can be retried with the next file. */
function lazy<T>(load: () => Promise<T>) {
  let module: T | null = null
  let loading: Promise<T> | null = null
  return {
    get: () => module,
    load: () => {
      loading ??= load().then(
        (loaded) => {
          module = loaded
          return loaded
        },
        (error: unknown) => {
          loading = null
          throw error
        },
      )
      return loading
    },
  }
}

/** The pipeline and the result panels (./Results) load with the first file, not with the page. */
const results = lazy<ResultsModule>(() => import('./Results'))
/** The Python engine's client (Zod and the contract) loads when the visitor picks that engine. */
const client = lazy<ClientModule>(() => import('./serverClient'))

/**
 * Lets the "processing" message paint before the synchronous pipeline takes the main thread. Browsers pause
 * animation frames in tabs that are not painting, so a short timeout guarantees it never waits longer.
 */
const nextPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0))
    setTimeout(resolve, 100)
  })

interface Waiting {
  elapsedMs: number
  waking: boolean
}

interface Props {
  /** Base URL of the Python engine (PUBLIC_PYLAB_API_URL). Without it only the browser engine is offered. */
  pylabUrl?: string | null
}

/**
 * Lab demo: upload a messy file and watch it get read, typed, normalised, validated and split. By default all
 * of it runs in the browser (TypeScript); with PUBLIC_PYLAB_API_URL the visitor may send it to the Python
 * engine instead (FastAPI on Render), which also reads Excel and bigger files and returns the same result.
 */
export function DataMigrator({ pylabUrl = null }: Props) {
  const engine = useSignal<Engine>('browser')
  const working = useSignal(false)
  const status = useSignal('')
  const error = useSignal<string | null>(null)
  const source = useSignal<Source | null>(null)
  const result = useSignal<MigrationResult | null>(null)
  /** Bumped on every new result so the preview starts again on its first tab. */
  const run = useSignal(0)
  const serverStatus = useSignal<ServerStatus>({ phase: 'idle' })
  const limits = useSignal<PyLabLimits | null>(null)
  const meta = useSignal<MigrationMeta | null>(null)
  const browserMs = useSignal<number | null>(null)
  const waiting = useSignal<Waiting | null>(null)
  /** The workbook last sent, kept in memory to process another of its sheets. */
  const lastFile = useRef<File | null>(null)
  /** When the server last answered (epoch ms): it sleeps after about 15 minutes without traffic. */
  const lastAnswerAt = useRef<number | null>(null)
  const upload = useRef<AbortController | null>(null)
  const health = useRef<AbortController | null>(null)
  const inputHeading = useId()
  const stepsHeading = useId()
  const python = engine.value === 'server'

  useEffect(
    () => () => {
      upload.current?.abort()
      health.current?.abort()
    },
    [],
  )

  const fail = (message: string, { keepResult = false } = {}) => {
    batch(() => {
      working.value = false
      waiting.value = null
      error.value = message
      status.value = ''
      if (!keepResult) {
        result.value = null
        source.value = null
        meta.value = null
      }
    })
  }

  // --- Browser engine (TypeScript) ----------------------------------------------------------------------

  const processText = async (text: string, name: string, size: number) => {
    working.value = true
    error.value = null
    status.value = `Procesando «${name}»…`
    await nextPaint()
    let engineModule: ResultsModule
    try {
      engineModule = await results.load()
    } catch {
      fail(LOAD_ERROR)
      return
    }
    const outcome = engineModule.runMigration(text)
    if (!outcome.ok) {
      fail(outcome.error)
      return
    }
    batch(() => {
      source.value = { name, size }
      result.value = outcome.result
      meta.value = null
      run.value += 1
      working.value = false
      status.value = `Listo. ${summarySentence(outcome.result)}`
    })
  }

  const readInBrowser = async (file: File) => {
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

  // --- Python engine (FastAPI) ----------------------------------------------------------------------------

  /** GET /health as soon as the engine is chosen: it starts waking the server while the visitor picks a file. */
  const wakeServer = async () => {
    if (!pylabUrl) return
    health.current?.abort()
    const controller = new AbortController()
    health.current = controller
    const asleep = mayBeAsleep(lastAnswerAt.current, Date.now())
    const started = performance.now()
    serverStatus.value = { phase: 'checking', elapsedMs: 0, waking: false }
    const tick = setInterval(() => {
      const elapsedMs = performance.now() - started
      serverStatus.value = { phase: 'checking', elapsedMs, waking: isWaking({ elapsedMs, asleep }) }
    }, 250)
    try {
      const api = await client.load()
      const outcome = await api.fetchHealth(pylabUrl, { signal: controller.signal })
      if (outcome === null) return
      if (outcome.kind === 'ok') {
        lastAnswerAt.current = Date.now()
        limits.value = outcome.data.limits
        serverStatus.value = {
          phase: 'ready',
          totalMs: outcome.totalMs,
          woke: asleep && outcome.totalMs >= WAKE_HINT_AFTER_MS,
        }
      } else {
        const message =
          outcome.kind === 'error' ? outcome.error.message : serverFailureText(outcome.kind, true)
        serverStatus.value = { phase: 'unavailable', message }
      }
    } catch {
      serverStatus.value = { phase: 'unavailable', message: LOAD_ERROR }
    } finally {
      clearInterval(tick)
      if (health.current === controller) health.current = null
    }
  }

  const sendToServer = async (file: File, sheet: string | null) => {
    if (!pylabUrl) return
    const problem = checkServerFile(file.name, file.size, limits.value)
    if (problem) {
      fail(problem)
      return
    }
    const rerun = sheet !== null
    const controller = new AbortController()
    upload.current = controller
    const asleep = mayBeAsleep(lastAnswerAt.current, Date.now())
    const started = performance.now()
    batch(() => {
      working.value = true
      error.value = null
      waiting.value = { elapsedMs: 0, waking: false }
      status.value = rerun ? `Procesando la hoja «${sheet}»…` : `Enviando «${file.name}» al servidor…`
    })
    const tick = setInterval(() => {
      const current = waiting.value
      if (current === null) return
      const elapsedMs = performance.now() - started
      const waking = current.waking || isWaking({ elapsedMs, asleep })
      if (waking && !current.waking) status.value = SERVER_WAKING_TEXT
      waiting.value = { elapsedMs, waking }
    }, 250)

    let outcome: Awaited<ReturnType<ClientModule['postMigration']>>
    let waking = false
    try {
      const [api] = await Promise.all([client.load(), results.load()])
      outcome = await api.postMigration(pylabUrl, file, sheet, { signal: controller.signal })
    } catch {
      clearInterval(tick)
      fail(LOAD_ERROR, { keepResult: rerun })
      return
    } finally {
      clearInterval(tick)
      waking = waiting.value?.waking ?? false
      if (upload.current === controller) upload.current = null
    }

    if (outcome === null) {
      batch(() => {
        working.value = false
        waiting.value = null
        status.value = 'Cancelaste el envío del archivo.'
      })
      return
    }
    if (outcome.kind === 'ok' || outcome.kind === 'error') lastAnswerAt.current = Date.now()
    if (outcome.kind !== 'ok') {
      const message =
        outcome.kind === 'error' ? outcome.error.message : serverFailureText(outcome.kind, waking)
      fail(message, { keepResult: rerun })
      return
    }
    const { result: migrated, meta: details } = outcome.data
    const woke = asleep && outcome.totalMs >= WAKE_HINT_AFTER_MS
    lastFile.current = file
    batch(() => {
      if (serverStatus.value.phase !== 'ready') {
        serverStatus.value = { phase: 'ready', totalMs: outcome.totalMs, woke }
      }
      source.value = { name: file.name, size: file.size }
      result.value = migrated
      meta.value = details
      browserMs.value = outcome.totalMs
      run.value += 1
      working.value = false
      waiting.value = null
      status.value = `Listo. ${summarySentence(migrated)}${woke ? ` ${serverWokeText(outcome.totalMs)}` : ''}`
    })
  }

  // --- Shared ---------------------------------------------------------------------------------------------

  const chooseEngine = (next: Engine) => {
    if (next === engine.value) return
    batch(() => {
      engine.value = next
      result.value = null
      source.value = null
      meta.value = null
      error.value = null
      status.value = ''
    })
    if (next === 'server' && serverStatus.value.phase !== 'ready') void wakeServer()
  }

  const handleFile = (file: File) => {
    if (python) void sendToServer(file, null)
    else void readInBrowser(file)
  }

  const trySample = () => {
    if (python) {
      void sendToServer(new File([SAMPLE_CSV], SAMPLE_NAME, { type: 'text/csv' }), null)
    } else {
      void processText(SAMPLE_CSV, SAMPLE_NAME, new TextEncoder().encode(SAMPLE_CSV).length)
    }
  }

  const chooseSheet = (sheet: string) => {
    if (lastFile.current) void sendToServer(lastFile.current, sheet)
  }

  const current = result.value
  const currentSource = source.value
  const currentMeta = meta.value
  const resultsModule = results.get()

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
          {pylabUrl && (
            <EngineChoice
              engine={engine.value}
              disabled={working.value}
              status={serverStatus.value}
              onChange={chooseEngine}
              onRetry={() => void wakeServer()}
            />
          )}
          <DropZone
            disabled={working.value}
            onFile={handleFile}
            {...(python && {
              accept: SERVER_ACCEPT,
              fileNoun: 'tu CSV o Excel',
              hint: limitsText(limits.value),
            })}
          />
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
          <div class="grid gap-2">
            <p role="status" class="flex min-h-7 items-center gap-2 text-step--1">
              {working.value && (
                <LoaderCircle class="shrink-0 motion-safe:animate-spin" size={18} aria-hidden="true" />
              )}
              {status.value}
            </p>
            {waiting.value && (
              <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-step--1 text-muted">
                {waiting.value.elapsedMs >= 1000 && (
                  <span class="tabular-nums" aria-hidden="true">
                    Esperando al servidor: {formatDuration(Math.floor(waiting.value.elapsedMs / 1000) * 1000)}
                  </span>
                )}
                <button type="button" class="btn btn-quiet" onClick={() => upload.current?.abort()}>
                  <X class="shrink-0" size={18} aria-hidden="true" />
                  Cancelar
                </button>
              </div>
            )}
          </div>
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
          {python ? (
            <>
              <ServerCog class="text-brand" size={28} aria-hidden="true" />
              <p class="font-semibold">Tu archivo viaja al servidor y no se guarda.</p>
              <p class="text-muted">
                Se envía cifrado (HTTPS) al servidor del Lab, que lo procesa en memoria y te devuelve el
                resultado. No se escribe en disco ni en una base de datos: cuando llega la respuesta, el
                archivo ya no existe allá.
              </p>
            </>
          ) : (
            <>
              <ShieldCheck class="text-brand" size={28} aria-hidden="true" />
              <p class="font-semibold">Tu archivo nunca sale de tu navegador.</p>
              <p class="text-muted">
                Se lee y se procesa aquí mismo, en tu dispositivo. No se envía a ningún servidor ni se guarda:
                al cerrar la pestaña, desaparece.
              </p>
            </>
          )}
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
        {current && currentMeta && (
          <ServerDetails
            meta={currentMeta}
            browserMs={browserMs.value}
            busy={working.value}
            onSheet={chooseSheet}
          />
        )}
        <PipelineSteps
          result={current}
          source={currentSource}
          engine={engine.value}
          server={currentMeta?.source ?? null}
        />
      </section>

      {current && currentSource && resultsModule && (
        <resultsModule.Results
          result={current}
          sourceName={currentSource.name}
          run={run.value}
          fromWorkbook={currentMeta ? isWorkbook(currentMeta.source) : false}
          onDownloaded={(fileName) => {
            status.value = `Se descargó «${fileName}».`
          }}
        />
      )}
    </div>
  )
}
