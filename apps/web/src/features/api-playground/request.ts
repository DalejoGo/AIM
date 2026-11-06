import { SANDBOX_HEADER, TASKS_PATH } from './config'

/**
 * The request the console sends: method, path (with its query) and JSON body, checked before anything leaves
 * the browser. The path is the single source of truth: the filter controls and the task picker read it and
 * write it back, so editing the path by hand and using the controls never disagree.
 */

export const METHODS = ['GET', 'POST', 'PATCH', 'DELETE'] as const
export type Method = (typeof METHODS)[number]

export const isMethod = (value: unknown): value is Method => METHODS.includes(value as Method)

/** Only POST and PATCH carry a body in this API. */
export const sendsBody = (method: Method) => method === 'POST' || method === 'PATCH'

export interface RequestDraft {
  method: Method
  /** Relative to the API URL, starting with `/`, query included. */
  path: string
  /** JSON text as typed; ignored for GET and DELETE. */
  body: string
}

/** What `fetch` gets, and what the curl and fetch snippets show. */
export interface PreparedRequest {
  method: Method
  path: string
  url: string
  headers: [name: string, value: string][]
  /** Compact JSON, or `null` when nothing is sent. */
  body: string | null
}

export type Problem = { field: 'path' | 'body'; message: string }

// --- Path and query ---------------------------------------------------------------------------------------

/** Stands for the task id in the examples until the visitor picks one. */
export const ID_PLACEHOLDER = '{id}'

export const MAX_PATH_LENGTH = 2048

/** The pathname and the query of a relative path. */
export function splitPath(path: string): { pathname: string; params: URLSearchParams } {
  const withoutHash = path.split('#', 1)[0] ?? ''
  const mark = withoutHash.indexOf('?')
  if (mark === -1) return { pathname: withoutHash, params: new URLSearchParams() }
  return { pathname: withoutHash.slice(0, mark), params: new URLSearchParams(withoutHash.slice(mark + 1)) }
}

/** Percent-encodes a query value but keeps `:` readable (`sort=createdAt:desc`), as RFC 3986 allows. */
const encodeQueryPart = (value: string) => encodeURIComponent(value).replace(/%3A/gi, ':')

export function joinPath(pathname: string, params: URLSearchParams): string {
  const query = [...params].map(([key, value]) => `${encodeQueryPart(key)}=${encodeQueryPart(value)}`)
  return query.length > 0 ? `${pathname}?${query.join('&')}` : pathname
}

/** Sets one query parameter (or removes it when the value is empty), keeping the others and their order. */
export function withParam(path: string, key: string, value: string | null): string {
  const { pathname, params } = splitPath(path)
  if (value === null || value.trim() === '') params.delete(key)
  else params.set(key, value)
  return joinPath(pathname, params)
}

const trimSlash = (pathname: string) => (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname)

/** GET /api/v1/tasks: the list, which takes the filters. */
export const isListPath = (path: string) => trimSlash(splitPath(path).pathname) === TASKS_PATH

const TASK_SEGMENT = new RegExp(`^${TASKS_PATH.replaceAll('/', '\\/')}\\/([^/]+)\\/?$`)

/** The id segment of /api/v1/tasks/:id (decoded), or `null` for any other path. `stats` is not an id. */
export function taskIdOf(path: string): string | null {
  const match = TASK_SEGMENT.exec(splitPath(path).pathname)
  const segment = match?.[1]
  if (!segment) return null
  let id: string
  try {
    id = decodeURIComponent(segment)
  } catch {
    id = segment
  }
  return id === 'stats' ? null : id
}

/** /api/v1/tasks/:id for a picked id (task endpoints take no query). */
export function taskPath(id: string = ID_PLACEHOLDER): string {
  return `${TASKS_PATH}/${id === ID_PLACEHOLDER ? id : encodeURIComponent(id)}`
}

export interface ListFilters {
  status: string
  priority: string
  q: string
  sort: string
  limit: string
  cursor: string
}

export const LIST_FILTER_KEYS = ['status', 'priority', 'q', 'sort', 'limit', 'cursor'] as const

/** The list filters written in the path ('' when absent). */
export function readListFilters(path: string): ListFilters {
  const { params } = splitPath(path)
  const read = (key: keyof ListFilters) => params.get(key) ?? ''
  return {
    status: read('status'),
    priority: read('priority'),
    q: read('q'),
    sort: read('sort'),
    limit: read('limit'),
    cursor: read('cursor'),
  }
}

/** A filter change asks for the first page again: a cursor only works with the filters it was made for. */
export function withListFilter(path: string, key: keyof ListFilters, value: string): string {
  const next = withParam(path, key, value)
  return key === 'cursor' ? next : withParam(next, 'cursor', null)
}

/** Checks the path before sending. Returns the message to show, or `null` when it is fine. */
export function pathProblem(path: string): string | null {
  if (path.trim() === '') return 'Escribe la ruta del endpoint, por ejemplo /api/v1/tasks.'
  if (!path.startsWith('/')) return 'La ruta debe empezar con /, por ejemplo /api/v1/tasks.'
  if (path.length > MAX_PATH_LENGTH)
    return `La ruta es demasiado larga: el máximo es ${MAX_PATH_LENGTH} caracteres.`
  if (/\s/.test(path)) return 'La ruta no puede tener espacios. Escríbelos como %20 o usa el campo Buscar.'
  if (path.includes(ID_PLACEHOLDER)) {
    return `Elige una tarea en la lista Tarea o cambia ${ID_PLACEHOLDER} por el id de una tarea.`
  }
  return null
}

/**
 * The full URL. The path is appended to the API URL (never resolved against it), so a path such as
 * `//otro.sitio` stays on the API host and the sandbox id never goes anywhere else.
 */
export function requestUrl(apiUrl: string, path: string): string | null {
  try {
    const url = new URL(`${apiUrl}${path}`)
    return url.origin === new URL(apiUrl).origin ? url.href : null
  } catch {
    return null
  }
}

// --- Body ---------------------------------------------------------------------------------------------------

export type BodyCheck = { ok: true; json: string | null } | { ok: false; message: string }

/** Line and column (from 1) of an offset in a text. */
export function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)))
  const lines = before.split('\n')
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}

/**
 * Where JSON.parse stopped, from its error message. Each engine words it differently: Chrome and Node say
 * "at position 7 (line 1 column 8)", Firefox "at line 1 column 8", and an unfinished text ends at its end.
 */
export function jsonErrorLocation(message: string, text: string): { line: number; column: number } | null {
  const lineColumn = /line (\d+) column (\d+)/i.exec(message)
  if (lineColumn) return { line: Number(lineColumn[1]), column: Number(lineColumn[2]) }
  const position = /position (\d+)/i.exec(message)
  if (position) return lineAndColumn(text, Number(position[1]))
  if (/unexpected end|end of (the )?(json )?(data|input)/i.test(message))
    return lineAndColumn(text, text.length)
  return null
}

/** The usual slip behind invalid JSON typed by hand, as advice. */
export function jsonHint(text: string): string {
  if (/'[^'\n]*'\s*:|:\s*'/.test(text)) {
    return 'JSON solo acepta comillas dobles: escribe "texto" en lugar de \'texto\'.'
  }
  if (/,\s*[}\]]/.test(text)) return 'Sobra una coma antes de una } o una ].'
  if (/[{,]\s*[A-Za-z_$][\w$-]*\s*:/.test(text)) {
    return 'Los nombres de los campos van entre comillas dobles, por ejemplo "title".'
  }
  const opened = (text.match(/[{[]/g) ?? []).length
  const closed = (text.match(/[}\]]/g) ?? []).length
  if (opened > closed) return 'Falta cerrar una llave } o un corchete ].'
  return 'Revisa las comillas, las comas y las llaves.'
}

/** Validates the body: empty means "send nothing"; otherwise it must be JSON, sent compact. */
export function checkBody(text: string): BodyCheck {
  if (text.trim() === '') return { ok: true, json: null }
  try {
    return { ok: true, json: JSON.stringify(JSON.parse(text)) }
  } catch (error) {
    const reason = error instanceof Error ? error.message : ''
    const where = jsonErrorLocation(reason, text)
    const place = where ? ` (línea ${where.line}, columna ${where.column})` : ''
    return { ok: false, message: `El cuerpo no es un JSON válido${place}. ${jsonHint(text)}` }
  }
}

/** The body indented with 2 spaces, or `null` when it is not JSON (the button then leaves it as is). */
export function formatJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return null
  }
}

// --- Putting it together -------------------------------------------------------------------------------------

export type Preparation = { ok: true; request: PreparedRequest } | { ok: false; problem: Problem }

/** Checks the draft and builds the request; nothing is sent when a problem comes back. */
export function prepareRequest(draft: RequestDraft, apiUrl: string, sandboxId: string): Preparation {
  const pathError = pathProblem(draft.path)
  if (pathError) return { ok: false, problem: { field: 'path', message: pathError } }
  const url = requestUrl(apiUrl, draft.path)
  if (!url) return { ok: false, problem: { field: 'path', message: 'La ruta no es válida. Revísala.' } }

  let body: string | null = null
  if (sendsBody(draft.method)) {
    const check = checkBody(draft.body)
    if (!check.ok) return { ok: false, problem: { field: 'body', message: check.message } }
    body = check.json
  }

  const headers: [string, string][] = []
  if (body !== null) headers.push(['Content-Type', 'application/json'])
  headers.push([SANDBOX_HEADER, sandboxId])
  return { ok: true, request: { method: draft.method, path: draft.path, url, headers, body } }
}

/** Builds the request for the snippets even while the body is not valid JSON yet (it goes as typed). */
export function previewRequest(draft: RequestDraft, apiUrl: string, sandboxId: string): PreparedRequest {
  const prepared = prepareRequest(draft, apiUrl, sandboxId)
  if (prepared.ok) return prepared.request
  const text = draft.body.trim()
  const body = sendsBody(draft.method) && text !== '' ? text : null
  const headers: [string, string][] = body === null ? [] : [['Content-Type', 'application/json']]
  headers.push([SANDBOX_HEADER, sandboxId])
  return { method: draft.method, path: draft.path, url: `${apiUrl}${draft.path}`, headers, body }
}
