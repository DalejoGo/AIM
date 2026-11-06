import { describe, expect, it } from 'vitest'
import {
  checkBody,
  formatJson,
  ID_PLACEHOLDER,
  isListPath,
  isMethod,
  joinPath,
  jsonErrorLocation,
  jsonHint,
  lineAndColumn,
  MAX_PATH_LENGTH,
  pathProblem,
  prepareRequest,
  previewRequest,
  readListFilters,
  requestUrl,
  sendsBody,
  splitPath,
  taskIdOf,
  taskPath,
  withListFilter,
  withParam,
} from './request'

const API = 'https://playground.test'
const SANDBOX = '0b6e7d2a-3f4c-4b8e-9a1d-5c2f8e7a6b10'
const TASK = '5d0f8a5e-8a39-4c55-9a43-0f5b8c1d2e3f'

describe('methods', () => {
  it('knows the four methods of the API and which carry a body', () => {
    expect(['GET', 'POST', 'PATCH', 'DELETE'].every(isMethod)).toBe(true)
    expect(isMethod('PUT')).toBe(false)
    expect(isMethod('get')).toBe(false)
    expect(['GET', 'POST', 'PATCH', 'DELETE'].filter((m) => isMethod(m) && sendsBody(m))).toEqual([
      'POST',
      'PATCH',
    ])
  })
})

describe('splitPath and joinPath', () => {
  it('split the pathname from the query and drop the fragment', () => {
    const { pathname, params } = splitPath('/api/v1/tasks?status=done&q=a+b#top')
    expect(pathname).toBe('/api/v1/tasks')
    expect([...params]).toEqual([
      ['status', 'done'],
      ['q', 'a b'],
    ])
    expect(splitPath('/api/v1/tasks').pathname).toBe('/api/v1/tasks')
  })

  it('join with percent-encoding, keeping : readable', () => {
    const params = new URLSearchParams([
      ['sort', 'createdAt:desc'],
      ['q', 'café & té'],
    ])
    expect(joinPath('/api/v1/tasks', params)).toBe(
      '/api/v1/tasks?sort=createdAt:desc&q=caf%C3%A9%20%26%20t%C3%A9',
    )
    expect(joinPath('/api/v1/tasks', new URLSearchParams())).toBe('/api/v1/tasks')
  })
})

describe('withParam and withListFilter', () => {
  it('set, replace and remove one parameter, keeping the others in order', () => {
    const path = '/api/v1/tasks?sort=createdAt:desc&limit=10'
    expect(withParam(path, 'status', 'done')).toBe('/api/v1/tasks?sort=createdAt:desc&limit=10&status=done')
    expect(withParam(path, 'limit', '5')).toBe('/api/v1/tasks?sort=createdAt:desc&limit=5')
    expect(withParam(path, 'limit', '')).toBe('/api/v1/tasks?sort=createdAt:desc')
    expect(withParam('/api/v1/tasks?limit=5', 'limit', null)).toBe('/api/v1/tasks')
  })

  it('drop the cursor when a filter changes, but not when the cursor itself does', () => {
    const page2 = '/api/v1/tasks?limit=2&cursor=abc'
    expect(withListFilter(page2, 'status', 'pending')).toBe('/api/v1/tasks?limit=2&status=pending')
    expect(withListFilter(page2, 'cursor', 'xyz')).toBe('/api/v1/tasks?limit=2&cursor=xyz')
  })

  it('round-trips text with symbols through the path', () => {
    const path = withListFilter('/api/v1/tasks', 'q', 'diseño "final" & más?')
    expect(readListFilters(path).q).toBe('diseño "final" & más?')
  })
})

describe('readListFilters', () => {
  it('reads every filter, empty when absent', () => {
    expect(readListFilters('/api/v1/tasks?status=done&priority=high&q=api&sort=dueDate:asc&limit=5')).toEqual(
      {
        status: 'done',
        priority: 'high',
        q: 'api',
        sort: 'dueDate:asc',
        limit: '5',
        cursor: '',
      },
    )
    expect(readListFilters('/api/v1/tasks')).toEqual({
      status: '',
      priority: '',
      q: '',
      sort: '',
      limit: '',
      cursor: '',
    })
  })
})

describe('isListPath and taskIdOf', () => {
  it('recognise the list, with or without query and trailing slash', () => {
    expect(isListPath('/api/v1/tasks')).toBe(true)
    expect(isListPath('/api/v1/tasks/?limit=1')).toBe(true)
    expect(isListPath('/api/v1/tasks/stats')).toBe(false)
    expect(isListPath('/api/v1/taskss')).toBe(false)
  })

  it('read the id of /api/v1/tasks/:id, but not stats', () => {
    expect(taskIdOf(`/api/v1/tasks/${TASK}`)).toBe(TASK)
    expect(taskIdOf(`/api/v1/tasks/${TASK}/`)).toBe(TASK)
    expect(taskIdOf(`/api/v1/tasks/${ID_PLACEHOLDER}`)).toBe(ID_PLACEHOLDER)
    expect(taskIdOf('/api/v1/tasks/a%20b')).toBe('a b')
    expect(taskIdOf('/api/v1/tasks/%E0%A4%A')).toBe('%E0%A4%A')
    expect(taskIdOf('/api/v1/tasks/stats')).toBeNull()
    expect(taskIdOf('/api/v1/tasks')).toBeNull()
    expect(taskIdOf(`/api/v1/tasks/${TASK}/extra`)).toBeNull()
  })

  it('build the task path with the placeholder or an encoded id', () => {
    expect(taskPath()).toBe('/api/v1/tasks/{id}')
    expect(taskPath(TASK)).toBe(`/api/v1/tasks/${TASK}`)
    expect(taskPath('a/b')).toBe('/api/v1/tasks/a%2Fb')
  })
})

describe('pathProblem', () => {
  it('accepts normal paths', () => {
    expect(pathProblem('/api/v1/tasks?limit=10')).toBeNull()
    expect(pathProblem('/api/v1/health')).toBeNull()
  })

  it('explains what to fix', () => {
    expect(pathProblem('')).toMatch(/Escribe la ruta/)
    expect(pathProblem('api/v1/tasks')).toMatch(/empezar con \//)
    expect(pathProblem('/api/v1/tasks?q=dos palabras')).toMatch(/espacios/)
    expect(pathProblem(taskPath())).toMatch(/Elige una tarea/)
    expect(pathProblem(`/${'a'.repeat(MAX_PATH_LENGTH)}`)).toMatch(/demasiado larga/)
  })
})

describe('requestUrl', () => {
  it('appends the path to the API URL', () => {
    expect(requestUrl(API, '/api/v1/tasks?limit=1')).toBe('https://playground.test/api/v1/tasks?limit=1')
    expect(requestUrl('https://playground.test/base', '/api')).toBe('https://playground.test/base/api')
  })

  it('never leaves the API host, so the sandbox id goes nowhere else', () => {
    expect(requestUrl(API, '//evil.example/x')).toBe('https://playground.test//evil.example/x')
    expect(requestUrl(API, '@evil.example')).toBeNull()
    expect(requestUrl(API, ':99999')).toBeNull()
  })
})

describe('lineAndColumn and jsonErrorLocation', () => {
  it('count lines and columns from 1', () => {
    expect(lineAndColumn('abc', 0)).toEqual({ line: 1, column: 1 })
    expect(lineAndColumn('{\n  "a": x\n}', 9)).toEqual({ line: 2, column: 8 })
    expect(lineAndColumn('ab', 99)).toEqual({ line: 1, column: 3 })
  })

  it('reads the position each engine reports', () => {
    const text = '{\n  "a": 1,\n}'
    expect(
      jsonErrorLocation(
        'Expected double-quoted property name in JSON at position 12 (line 3 column 1)',
        text,
      ),
    ).toEqual({
      line: 3,
      column: 1,
    })
    expect(jsonErrorLocation('Unexpected token } in JSON at position 12', text)).toEqual({
      line: 3,
      column: 1,
    })
    expect(
      jsonErrorLocation(
        'JSON.parse: expected double-quoted property name at line 3 column 1 of the JSON data',
        text,
      ),
    ).toEqual({ line: 3, column: 1 })
    expect(jsonErrorLocation('Unexpected end of JSON input', '{"a":')).toEqual({ line: 1, column: 6 })
    expect(jsonErrorLocation("JSON Parse error: Expected '}'", text)).toBeNull()
  })
})

describe('jsonHint', () => {
  it('spots the usual slips', () => {
    expect(jsonHint("{'title': 'x'}")).toMatch(/comillas dobles/)
    expect(jsonHint('{"title": "x",}')).toMatch(/Sobra una coma/)
    expect(jsonHint('{title: "x"}')).toMatch(/nombres de los campos/)
    expect(jsonHint('{"title": "x"')).toMatch(/Falta cerrar/)
    expect(jsonHint('{"title": x}')).toMatch(/Revisa/)
  })
})

describe('checkBody', () => {
  it('sends nothing for an empty body', () => {
    expect(checkBody('')).toEqual({ ok: true, json: null })
    expect(checkBody('  \n ')).toEqual({ ok: true, json: null })
  })

  it('sends valid JSON compact', () => {
    expect(checkBody('{\n  "title": "Comprar pan",\n  "tags": [1, 2]\n}')).toEqual({
      ok: true,
      json: '{"title":"Comprar pan","tags":[1,2]}',
    })
    expect(checkBody('"solo texto"')).toEqual({ ok: true, json: '"solo texto"' })
  })

  it('says where the JSON breaks and why, in Spanish', () => {
    const result = checkBody('{\n  "title": "x",\n}')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/^El cuerpo no es un JSON válido \(línea 3, columna 1\)\./)
    expect(result.message).toMatch(/Sobra una coma/)

    const quotes = checkBody("{'title': 'x'}")
    expect(quotes.ok === false && quotes.message).toMatch(/línea 1, columna 2.*comillas dobles/)
  })
})

describe('formatJson', () => {
  it('indents valid JSON and leaves invalid text alone', () => {
    expect(formatJson('{"a":1,"b":[true,null]}')).toBe('{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}')
    expect(formatJson('{a:1}')).toBeNull()
  })
})

describe('prepareRequest', () => {
  it('builds a GET with only the sandbox header', () => {
    const prepared = prepareRequest(
      { method: 'GET', path: '/api/v1/tasks?limit=1', body: '{"ignored": true}' },
      API,
      SANDBOX,
    )
    expect(prepared).toEqual({
      ok: true,
      request: {
        method: 'GET',
        path: '/api/v1/tasks?limit=1',
        url: 'https://playground.test/api/v1/tasks?limit=1',
        headers: [['X-Sandbox-Id', SANDBOX]],
        body: null,
      },
    })
  })

  it('adds Content-Type and the compact body to POST and PATCH', () => {
    const prepared = prepareRequest(
      { method: 'PATCH', path: taskPath(TASK), body: '{ "status": "done" }' },
      API,
      SANDBOX,
    )
    expect(prepared.ok && prepared.request.headers).toEqual([
      ['Content-Type', 'application/json'],
      ['X-Sandbox-Id', SANDBOX],
    ])
    expect(prepared.ok && prepared.request.body).toBe('{"status":"done"}')
  })

  it('sends a POST with an empty body as is, so the API can answer it', () => {
    const prepared = prepareRequest({ method: 'POST', path: '/api/v1/tasks', body: '' }, API, SANDBOX)
    expect(prepared.ok && prepared.request).toMatchObject({
      body: null,
      headers: [['X-Sandbox-Id', SANDBOX]],
    })
  })

  it('stops on a bad path or body and says which field', () => {
    expect(prepareRequest({ method: 'GET', path: taskPath(), body: '' }, API, SANDBOX)).toMatchObject({
      ok: false,
      problem: { field: 'path' },
    })
    expect(prepareRequest({ method: 'GET', path: '@evil', body: '' }, API, SANDBOX)).toMatchObject({
      ok: false,
      problem: { field: 'path' },
    })
    expect(prepareRequest({ method: 'POST', path: '/api/v1/tasks', body: '{' }, API, SANDBOX)).toMatchObject({
      ok: false,
      problem: { field: 'body', message: expect.stringMatching(/no es un JSON válido/) },
    })
  })
})

describe('previewRequest', () => {
  it('is the prepared request when the draft is valid', () => {
    const draft = { method: 'POST', path: '/api/v1/tasks', body: '{"title": "abc"}' } as const
    const prepared = prepareRequest(draft, API, SANDBOX)
    expect(prepared.ok && previewRequest(draft, API, SANDBOX)).toEqual(prepared.ok && prepared.request)
  })

  it('keeps the body as typed while it is not JSON yet', () => {
    const preview = previewRequest(
      { method: 'POST', path: '/api/v1/tasks', body: " {'title': 1} " },
      API,
      SANDBOX,
    )
    expect(preview.body).toBe("{'title': 1}")
    expect(preview.headers).toEqual([
      ['Content-Type', 'application/json'],
      ['X-Sandbox-Id', SANDBOX],
    ])
    expect(previewRequest({ method: 'GET', path: taskPath(), body: '' }, API, SANDBOX).url).toBe(
      'https://playground.test/api/v1/tasks/{id}',
    )
  })
})
