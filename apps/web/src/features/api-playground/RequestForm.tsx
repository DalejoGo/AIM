import { CircleCheck, Send } from 'lucide-preact'
import type { TargetedEvent } from 'preact'
import { a11yProps, Field, FieldError, inputClass, Spinner } from '../forms/fields'
import {
  EXAMPLES,
  type ExampleId,
  MAX_LIMIT,
  PRIORITY_OPTIONS,
  SORT_OPTIONS,
  STATUS_OPTIONS,
} from './examples'
import type { KnownTask } from './history'
import {
  checkBody,
  formatJson,
  ID_PLACEHOLDER,
  isListPath,
  type ListFilters,
  METHODS,
  type Method,
  type Problem,
  pathProblem,
  type RequestDraft,
  readListFilters,
  requestUrl,
  sendsBody,
  taskIdOf,
  taskPath,
  withListFilter,
} from './request'

export const REQUEST_HEADING = 'playground-request'
export const PATH_ID = 'playground-path'
export const BODY_ID = 'playground-body'

const codeInput = `${inputClass} font-mono text-step--1`

interface RequestFormProps {
  apiUrl: string
  draft: RequestDraft
  exampleId: ExampleId | null
  knownTasks: readonly KnownTask[]
  /** What stopped the last send; shown on its field until fixed. */
  problem: Problem | null
  /** The visitor typed in the body: from then on it is checked as they type. */
  bodyEdited: boolean
  busy: boolean
  onExample: (id: ExampleId) => void
  onChange: (draft: RequestDraft, edited?: 'body') => void
  onSend: () => void
  onCancel: () => void
}

function ExamplePicker({ exampleId, onExample }: Pick<RequestFormProps, 'exampleId' | 'onExample'>) {
  const current = EXAMPLES.find((example) => example.id === exampleId)
  return (
    <fieldset class="grid min-w-0 gap-2">
      <legend class="mb-2 font-semibold">Ejemplos</legend>
      <div class="flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example.id}
            type="button"
            aria-pressed={example.id === exampleId}
            class="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-left text-step--1 transition-colors hover:border-brand aria-pressed:border-brand aria-pressed:bg-raised aria-pressed:font-semibold"
            onClick={() => onExample(example.id)}
          >
            <span class="font-mono text-muted">{example.method}</span> <span>{example.label}</span>
          </button>
        ))}
      </div>
      {current && <p class="text-step--1 text-muted">{current.description}</p>}
    </fieldset>
  )
}

function ListFilterFields({ draft, onChange }: Pick<RequestFormProps, 'draft' | 'onChange'>) {
  const filters = readListFilters(draft.path)
  const set = (key: keyof ListFilters) => (event: TargetedEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...draft, path: withListFilter(draft.path, key, event.currentTarget.value) })

  return (
    <fieldset class="grid min-w-0 gap-4 rounded-xl border border-line p-4">
      <legend class="px-1 font-semibold">Filtros de la lista</legend>
      <p class="-mt-2 text-step--1 text-muted">
        Cada cambio se escribe en la ruta, y lo que escribas en la ruta se ve aquí.
      </p>
      <div class="grid items-end gap-4 sm:grid-cols-2">
        <Field id="playground-status" label="Estado">
          <select
            {...a11yProps('playground-status', {})}
            class={inputClass}
            value={filters.status}
            onChange={set('status')}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="playground-priority" label="Prioridad">
          <select
            {...a11yProps('playground-priority', {})}
            class={inputClass}
            value={filters.priority}
            onChange={set('priority')}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <div class="sm:col-span-2">
          <Field
            id="playground-q"
            label="Buscar"
            hint="En el título y la descripción, sin importar mayúsculas ni tildes."
          >
            <input
              {...a11yProps('playground-q', { hint: true })}
              type="search"
              class={inputClass}
              value={filters.q}
              maxLength={100}
              autocomplete="off"
              onInput={set('q')}
            />
          </Field>
        </div>
        <Field id="playground-sort" label="Orden">
          <select
            {...a11yProps('playground-sort', {})}
            class={inputClass}
            value={filters.sort || SORT_OPTIONS[0].value}
            onChange={set('sort')}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="playground-limit" label="Por página" hint={`De 1 a ${MAX_LIMIT}.`}>
          <input
            {...a11yProps('playground-limit', { hint: true })}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_LIMIT}
            class={inputClass}
            value={filters.limit}
            onInput={set('limit')}
          />
        </Field>
      </div>
      {filters.cursor && (
        <p class="text-step--1 text-muted">
          Esta petición pide la página siguiente con un cursor.{' '}
          <button
            type="button"
            class="link"
            onClick={() => onChange({ ...draft, path: withListFilter(draft.path, 'cursor', '') })}
          >
            Volver a la primera página
          </button>
        </p>
      )}
    </fieldset>
  )
}

function TaskPicker({
  draft,
  taskId,
  knownTasks,
  onChange,
}: Pick<RequestFormProps, 'draft' | 'knownTasks' | 'onChange'> & { taskId: string }) {
  const known = knownTasks.some((task) => task.id === taskId)
  const typed = !known && taskId !== ID_PLACEHOLDER
  const hint =
    knownTasks.length === 0
      ? 'Todavía no conoces ninguna tarea: envía primero Listar tareas o crea una. También puedes pegar un id en la ruta.'
      : 'Las tareas que ya viste en las respuestas. También puedes pegar un id en la ruta.'
  return (
    <Field id="playground-task" label="Tarea" hint={hint}>
      <select
        {...a11yProps('playground-task', { hint: true })}
        class={inputClass}
        value={known || typed ? taskId : ''}
        onChange={(event) => onChange({ ...draft, path: taskPath(event.currentTarget.value) })}
      >
        <option value="" disabled>
          Elige una tarea
        </option>
        {typed && <option value={taskId}>El id que escribiste en la ruta</option>}
        {knownTasks.map((task) => (
          <option key={task.id} value={task.id}>
            {task.title || 'Sin título'} ({task.id.slice(0, 8)})
          </option>
        ))}
      </select>
    </Field>
  )
}

function BodyField({
  draft,
  problem,
  bodyEdited,
  onChange,
}: Pick<RequestFormProps, 'draft' | 'problem' | 'bodyEdited' | 'onChange'>) {
  const check = checkBody(draft.body)
  const checking = bodyEdited || problem?.field === 'body'
  const error = checking && !check.ok ? check.message : undefined
  const valid = checking && check.ok && check.json !== null

  function format() {
    const formatted = formatJson(draft.body)
    onChange(formatted === null ? draft : { ...draft, body: formatted }, 'body')
  }

  return (
    <div class="grid min-w-0 gap-1.5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <label for={BODY_ID} class="font-semibold">
          Cuerpo (JSON)
        </label>
        <button type="button" class="btn btn-quiet min-h-9 px-3 py-1 text-step--1" onClick={format}>
          Formatear
        </button>
      </div>
      <p id={`${BODY_ID}-hint`} class="text-step--1 text-muted">
        Se revisa antes de enviarlo. Vacío, la petición va sin cuerpo.
      </p>
      <textarea
        {...a11yProps(BODY_ID, { hint: true, error })}
        class={`${codeInput} min-h-48 resize-y leading-relaxed`}
        rows={9}
        spellcheck={false}
        autocapitalize="off"
        autocomplete="off"
        value={draft.body}
        onInput={(event) => onChange({ ...draft, body: event.currentTarget.value }, 'body')}
      />
      {error && <FieldError id={`${BODY_ID}-error`}>{error}</FieldError>}
      {valid && (
        <p class="flex items-center gap-1.5 text-step--1">
          <CircleCheck size={16} class="shrink-0 text-live" aria-hidden="true" />
          JSON válido
        </p>
      )}
    </div>
  )
}

/** "Petición": examples, method, path with its filters or task, body and the send button. */
export function RequestForm(props: RequestFormProps) {
  const { apiUrl, draft, problem, busy, onChange, onSend, onCancel } = props
  const pathError =
    problem?.field === 'path'
      ? (pathProblem(draft.path) ?? (requestUrl(apiUrl, draft.path) ? undefined : problem.message))
      : undefined
  const taskId = taskIdOf(draft.path)
  const showFilters = draft.method === 'GET' && isListPath(draft.path)

  return (
    <section aria-labelledby={REQUEST_HEADING} class="grid min-w-0 content-start gap-6">
      <h2 id={REQUEST_HEADING} class="text-step-2 font-semibold">
        Petición
      </h2>
      <ExamplePicker exampleId={props.exampleId} onExample={props.onExample} />

      <form
        class="grid min-w-0 gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          onSend()
        }}
      >
        <div class="grid gap-1.5">
          <p class="text-step--1 text-muted">
            Servidor: <span class="font-mono wrap-anywhere text-text">{apiUrl}</span>
          </p>
          <div class="grid items-start gap-4 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
            <Field id="playground-method" label="Método">
              <select
                {...a11yProps('playground-method', {})}
                class={codeInput}
                value={draft.method}
                onChange={(event) => onChange({ ...draft, method: event.currentTarget.value as Method })}
              >
                {METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={PATH_ID} label="Ruta" error={pathError}>
              <input
                {...a11yProps(PATH_ID, { error: pathError })}
                type="text"
                class={codeInput}
                value={draft.path}
                spellcheck={false}
                autocapitalize="off"
                autocomplete="off"
                onInput={(event) => onChange({ ...draft, path: event.currentTarget.value })}
              />
            </Field>
          </div>
        </div>

        {showFilters && <ListFilterFields draft={draft} onChange={onChange} />}
        {taskId !== null && (
          <TaskPicker draft={draft} taskId={taskId} knownTasks={props.knownTasks} onChange={onChange} />
        )}

        {sendsBody(draft.method) ? (
          <BodyField draft={draft} problem={problem} bodyEdited={props.bodyEdited} onChange={onChange} />
        ) : (
          <p class="text-step--1 text-muted">{draft.method} no lleva cuerpo en esta API.</p>
        )}

        <div class="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            class="btn btn-primary aria-disabled:cursor-wait aria-disabled:opacity-70"
            aria-disabled={busy}
          >
            {busy ? <Spinner /> : <Send size={18} class="shrink-0" aria-hidden="true" />}
            {busy ? 'Enviando…' : 'Enviar petición'}
          </button>
          {busy && (
            <button type="button" class="btn btn-quiet" onClick={onCancel}>
              Cancelar
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
