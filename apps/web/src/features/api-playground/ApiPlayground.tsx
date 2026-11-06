import { batch, useSignal } from '@preact/signals'
import { CircleAlert, ExternalLink, RotateCcw } from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'
import { focusSoon } from '../forms/fields'
import { resultAnnouncement } from './announce'
import { CodeSnippets } from './CodeSnippets'
import { type Outcome, sendRequest } from './client'
import { docsUrl, SANDBOX_HEADER } from './config'
import { DEFAULT_EXAMPLE, type ExampleId, exampleDraft } from './examples'
import { HistoryList } from './HistoryList'
import {
  addExchange,
  type Exchange,
  HISTORY_KEY,
  type KnownTask,
  knownTasksFrom,
  lastAnswerAt,
  learnTasks,
  parseHistory,
  type SentRequest,
} from './history'
import { BODY_ID, PATH_ID, RequestForm } from './RequestForm'
import { ResponseView, type Waiting } from './ResponseView'
import {
  formatJson,
  type Problem,
  prepareRequest,
  previewRequest,
  type RequestDraft,
  withListFilter,
} from './request'
import { loadSandboxId, randomUuid, readItem, renewSandboxId, sessionStore, writeItem } from './sandbox'
import { isWaking, mayBeAsleep, WAKE_HINT_AFTER_MS, WAKING_TEXT } from './wake'

/** Shown in the snippets until the island has read or created the visitor's sandbox id. */
const SANDBOX_PLACEHOLDER = 'tu-sandbox-id'

/** An abort with this reason comes from "Empezar de cero", which announces its own result. */
const RESET = 'reset'

/** A request of the history back in the editor, with its body indented again. */
function toDraft(request: SentRequest): RequestDraft {
  const body = request.body === null ? '' : (formatJson(request.body) ?? request.body)
  return { method: request.method, path: request.path, body }
}

function NotConfigured() {
  return (
    <div class="grid gap-3 rounded-xl border border-line bg-raised p-4 sm:p-6">
      <p class="flex items-start gap-2 font-semibold">
        <CircleAlert size={20} class="mt-1 shrink-0 text-danger" aria-hidden="true" />
        La consola no está disponible en esta copia del sitio.
      </p>
      <p class="prose-measure text-muted">
        Le falta la dirección de la API, que se define al compilar el sitio con la variable{' '}
        <code class="font-mono text-step--1 text-text">PUBLIC_PLAYGROUND_API_URL</code>. En el sitio publicado
        la consola usa la API real.
      </p>
    </div>
  )
}

function SandboxBar({
  apiUrl,
  sandboxId,
  onReset,
}: {
  apiUrl: string
  sandboxId: string | null
  onReset: () => void
}) {
  return (
    <section
      aria-labelledby="playground-sandbox"
      class="grid gap-4 rounded-xl border border-line bg-raised p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-8"
    >
      <div class="grid min-w-0 gap-2">
        <h2 id="playground-sandbox" class="text-step-1 font-semibold">
          Tu sandbox
        </h2>
        <p class="prose-measure text-step--1 text-muted">
          Cada petición lleva este id en la cabecera <code class="font-mono text-text">{SANDBOX_HEADER}</code>
          . Es tu espacio privado en la API: empieza con 3 tareas de ejemplo, admite hasta 50 y se borra tras
          30 minutos sin uso.
        </p>
        <p class="font-mono text-step--1 wrap-anywhere" data-testid="sandbox-id">
          {sandboxId ?? 'Preparando tu sandbox…'}
        </p>
      </div>
      <div class="flex flex-wrap gap-3">
        <button type="button" class="btn btn-quiet" onClick={onReset}>
          <RotateCcw size={18} class="shrink-0" aria-hidden="true" />
          Empezar de cero
        </button>
        <a href={docsUrl(apiUrl)} target="_blank" rel="noopener" class="btn btn-quiet">
          Ver la documentación (Swagger)
          <ExternalLink size={16} class="shrink-0" aria-hidden="true" />
          <span class="sr-only">(se abre en una pestaña nueva)</span>
        </a>
      </div>
    </section>
  )
}

function Console({ apiUrl }: { apiUrl: string }) {
  const sandboxId = useSignal<string | null>(null)
  const exampleId = useSignal<ExampleId | null>(DEFAULT_EXAMPLE)
  const draft = useSignal<RequestDraft>(exampleDraft(DEFAULT_EXAMPLE, { now: Date.now() }))
  const problem = useSignal<Problem | null>(null)
  const bodyEdited = useSignal(false)
  const history = useSignal<Exchange[]>([])
  const knownTasks = useSignal<KnownTask[]>([])
  const selectedId = useSignal<string | null>(null)
  const waiting = useSignal<Waiting | null>(null)
  const announcement = useSignal('')
  const controller = useRef<AbortController | null>(null)
  /** When the API last answered (epoch ms); survives "Empezar de cero", which does not wake or sleep it. */
  const lastAnswer = useRef<number | null>(null)
  const responseHeading = useRef<HTMLHeadingElement>(null)

  // The sandbox and the history live in sessionStorage, which only exists in the browser.
  useEffect(() => {
    const storage = sessionStore()
    const stored = parseHistory(readItem(storage, HISTORY_KEY))
    lastAnswer.current = lastAnswerAt(stored)
    batch(() => {
      sandboxId.value = loadSandboxId(storage)
      history.value = stored
      knownTasks.value = knownTasksFrom(stored)
      selectedId.value = stored[0]?.id ?? null
    })
    return () => controller.current?.abort()
  }, [sandboxId, history, knownTasks, selectedId])

  function remember(list: Exchange[]) {
    history.value = list
    writeItem(sessionStore(), HISTORY_KEY, list.length > 0 ? JSON.stringify(list) : null)
  }

  function edit(next: RequestDraft, edited?: 'body') {
    batch(() => {
      draft.value = next
      if (edited === 'body') bodyEdited.value = true
    })
  }

  async function send(next: RequestDraft = draft.value) {
    const sandbox = sandboxId.value
    if (waiting.value !== null || sandbox === null) return
    const prepared = prepareRequest(next, apiUrl, sandbox)
    if (!prepared.ok) {
      problem.value = prepared.problem
      focusSoon(prepared.problem.field === 'path' ? PATH_ID : BODY_ID)
      return
    }
    const { request } = prepared
    const run = new AbortController()
    controller.current = run
    const at = Date.now()
    const asleep = mayBeAsleep(lastAnswer.current, at)
    const started = performance.now()
    batch(() => {
      problem.value = null
      waiting.value = { method: request.method, path: request.path, elapsedMs: 0, waking: false }
      announcement.value = `Enviando ${request.method} ${request.path}…`
    })
    const tick = setInterval(() => {
      const current = waiting.value
      if (current === null) return
      const elapsedMs = performance.now() - started
      const waking = current.waking || isWaking({ elapsedMs, asleep })
      if (waking && !current.waking) announcement.value = WAKING_TEXT
      waiting.value = { ...current, elapsedMs, waking }
    }, 250)

    let outcome: Outcome | null
    try {
      outcome = await sendRequest(request, { signal: run.signal })
    } finally {
      clearInterval(tick)
      if (controller.current === run) controller.current = null
      waiting.value = null
    }
    if (outcome === null) {
      if (run.signal.reason !== RESET) announcement.value = 'Cancelaste la petición.'
      return
    }
    if (outcome.kind === 'response') lastAnswer.current = at + outcome.totalMs

    const exchange: Exchange = {
      id: randomUuid(),
      at,
      request: { method: request.method, path: request.path, body: request.body },
      outcome,
      slowStart: asleep && outcome.totalMs >= WAKE_HINT_AFTER_MS,
    }
    batch(() => {
      remember(addExchange(history.value, exchange))
      knownTasks.value = learnTasks(knownTasks.value, exchange)
      selectedId.value = exchange.id
      announcement.value = resultAnnouncement(exchange)
    })
    // The button the visitor used may have gone with the previous answer: keep the focus in the response.
    setTimeout(() => {
      if (document.activeElement === document.body) responseHeading.current?.focus()
    }, 0)
  }

  function chooseExample(id: ExampleId) {
    batch(() => {
      exampleId.value = id
      draft.value = exampleDraft(id, { now: Date.now(), taskId: knownTasks.value[0]?.id })
      problem.value = null
      bodyEdited.value = false
    })
  }

  function resend(next: RequestDraft) {
    batch(() => {
      draft.value = next
      problem.value = null
      bodyEdited.value = false
    })
    void send(next)
  }

  function showFromHistory(exchange: Exchange) {
    batch(() => {
      selectedId.value = exchange.id
      draft.value = toDraft(exchange.request)
      exampleId.value = null
      problem.value = null
      bodyEdited.value = false
      announcement.value = `Mostrando la respuesta de ${exchange.request.method} ${exchange.request.path}.`
    })
  }

  function startOver() {
    controller.current?.abort(RESET)
    batch(() => {
      sandboxId.value = renewSandboxId(sessionStore())
      remember([])
      knownTasks.value = []
      selectedId.value = null
      exampleId.value = DEFAULT_EXAMPLE
      draft.value = exampleDraft(DEFAULT_EXAMPLE, { now: Date.now() })
      problem.value = null
      bodyEdited.value = false
      announcement.value =
        'Tienes un sandbox nuevo. Tu próxima petición lo estrena con las 3 tareas de ejemplo.'
    })
  }

  const list = history.value
  const selected = list.find((exchange) => exchange.id === selectedId.value) ?? null
  const preview = previewRequest(draft.value, apiUrl, sandboxId.value ?? SANDBOX_PLACEHOLDER)

  return (
    <div class="grid grid-cols-[minmax(0,1fr)] gap-12">
      <SandboxBar apiUrl={apiUrl} sandboxId={sandboxId.value} onReset={startOver} />

      <div class="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-2 lg:gap-x-10">
        <div class="min-w-0 lg:col-start-1 lg:row-start-1">
          <RequestForm
            apiUrl={apiUrl}
            draft={draft.value}
            exampleId={exampleId.value}
            knownTasks={knownTasks.value}
            problem={problem.value}
            bodyEdited={bodyEdited.value}
            busy={waiting.value !== null}
            onExample={chooseExample}
            onChange={edit}
            onSend={() => void send()}
            onCancel={() => controller.current?.abort()}
          />
        </div>
        <div class="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <ResponseView
            exchange={selected}
            waiting={waiting.value}
            announcement={announcement.value}
            headingRef={responseHeading}
            onRetry={(exchange) => resend(toDraft(exchange.request))}
            onNextPage={(exchange, cursor) =>
              resend({
                method: 'GET',
                path: withListFilter(exchange.request.path, 'cursor', cursor),
                body: '',
              })
            }
          />
        </div>
        <div class="min-w-0 lg:col-start-1 lg:row-start-2">
          <CodeSnippets request={preview} />
        </div>
      </div>

      <HistoryList history={list} selectedId={selectedId.value} onSelect={showFromHistory} />
    </div>
  )
}

/**
 * API Playground (DEC-011, DEC-014): a console for the Tareas API on Render. `apiUrl` comes from
 * PUBLIC_PLAYGROUND_API_URL at build time; without it the page explains why there is no console.
 */
export function ApiPlayground({ apiUrl }: { apiUrl: string | null }) {
  return apiUrl === null ? <NotConfigured /> : <Console apiUrl={apiUrl} />
}
