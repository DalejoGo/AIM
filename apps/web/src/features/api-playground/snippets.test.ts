import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { type PreparedRequest, prepareRequest, type RequestDraft } from './request'
import { jsKey, jsLiteral, jsString, shellQuote, toCurl, toFetch } from './snippets'

const API = 'https://playground.test'
const SANDBOX = '0b6e7d2a-3f4c-4b8e-9a1d-5c2f8e7a6b10'
const TASK = '5d0f8a5e-8a39-4c55-9a43-0f5b8c1d2e3f'

/** Texts that break naive quoting in a shell or in JavaScript. */
const TRICKY = [
  'simple',
  "it's",
  "'''",
  'say "hi"',
  'back\\slash',
  '$HOME `whoami` $(id)',
  'línea\nnueva\ty tab',
  'emoji 🚀 y ñ',
  '\u2028\u2029',
  '\u0000\u0007',
  '',
]

function prepared(draft: RequestDraft): PreparedRequest {
  const result = prepareRequest(draft, API, SANDBOX)
  if (!result.ok) throw new Error(result.problem.message)
  return result.request
}

/** What a POSIX shell makes of a quoted word. */
function shellEcho(word: string): string {
  const run = spawnSync('sh', ['-c', `printf '%s' ${word}`], { encoding: 'utf8' })
  return run.stdout
}

/** Runs a JavaScript expression (test only: the snippets are text the visitor copies). */
const evaluate = (source: string): unknown => new Function(`return (${source})`)()

describe('shellQuote', () => {
  it('gives the shell back exactly the same text', () => {
    for (const text of TRICKY.filter((t) => !t.includes('\u0000'))) {
      expect(shellEcho(shellQuote(text)), JSON.stringify(text)).toBe(text)
    }
  })

  it("closes, escapes and reopens on '", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
  })
})

describe('jsString', () => {
  it('is a single-quoted literal with the same value', () => {
    for (const text of TRICKY) expect(evaluate(jsString(text)), JSON.stringify(text)).toBe(text)
  })

  it('escapes quotes, backslashes and line breaks', () => {
    expect(jsString(`it's "ok" \\ \n`)).toBe(`'it\\'s "ok" \\\\ \\n'`)
    expect(jsString('\u2028')).toBe(`'\\u2028'`)
    expect(jsString('\u0007')).toBe(`'\\u0007'`)
  })
})

describe('jsKey and jsLiteral', () => {
  it('quote keys only when they are not identifiers', () => {
    expect(jsKey('title')).toBe('title')
    expect(jsKey('$ok_1')).toBe('$ok_1')
    expect(jsKey('Content-Type')).toBe(`'Content-Type'`)
    expect(jsKey("it's")).toBe(`'it\\'s'`)
    expect(jsKey('1a')).toBe(`'1a'`)
    expect(jsKey('__proto__')).toBe(`['__proto__']`)
  })

  it('write any JSON value as an equivalent literal', () => {
    const values = [
      { title: "it's", nested: { list: [1, 'dos', null, true, { 'x-y': [] }], empty: {} } },
      [],
      'texto',
      0,
      -1.5,
      false,
      null,
    ]
    for (const value of values) expect(evaluate(jsLiteral(value))).toEqual(value)
  })

  it('keeps __proto__ as a plain key', () => {
    const value = evaluate(jsLiteral(JSON.parse('{"__proto__": {"admin": true}}'))) as Record<string, unknown>
    expect(Object.keys(value)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
  })

  it('indents nested values', () => {
    expect(jsLiteral({ a: [1] }, '  ')).toBe('{\n    a: [\n      1,\n    ],\n  }')
  })
})

describe('toCurl', () => {
  it('writes a GET with the sandbox header', () => {
    expect(
      toCurl(prepared({ method: 'GET', path: '/api/v1/tasks?sort=createdAt:desc&limit=10', body: '' })),
    ).toBe(
      [
        `curl -i 'https://playground.test/api/v1/tasks?sort=createdAt:desc&limit=10' \\`,
        `  -H 'X-Sandbox-Id: ${SANDBOX}'`,
      ].join('\n'),
    )
  })

  it('writes a POST with method, JSON headers and the compact body', () => {
    const curl = toCurl(
      prepared({ method: 'POST', path: '/api/v1/tasks', body: '{\n  "title": "Comprar pan"\n}' }),
    )
    expect(curl).toBe(
      [
        `curl -i -X POST 'https://playground.test/api/v1/tasks' \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -H 'X-Sandbox-Id: ${SANDBOX}' \\`,
        `  --data '{"title":"Comprar pan"}'`,
      ].join('\n'),
    )
  })

  it('writes PATCH and DELETE with -X', () => {
    expect(toCurl(prepared({ method: 'DELETE', path: `/api/v1/tasks/${TASK}`, body: '' }))).toMatch(
      /^curl -i -X DELETE 'https:\/\/playground\.test\/api\/v1\/tasks\/5d0f8a5e/,
    )
    expect(
      toCurl(prepared({ method: 'PATCH', path: `/api/v1/tasks/${TASK}`, body: '{"status":"done"}' })),
    ).toContain(`--data '{"status":"done"}'`)
  })

  it('survives titles with \' and " when run in a shell', () => {
    const title = `Revisar el 'deploy' y el "build"`
    const curl = toCurl(prepared({ method: 'POST', path: '/api/v1/tasks', body: JSON.stringify({ title }) }))
    expect(curl).toContain(`'{"title":"Revisar el '\\''deploy'\\'' y el \\"build\\""}'`)
    const word = curl.split('--data ')[1] ?? ''
    expect(JSON.parse(shellEcho(word))).toEqual({ title })
  })

  it('quotes a path with odd characters typed by hand', () => {
    const curl = toCurl({
      method: 'GET',
      path: "/api/v1/tasks?q=it's",
      url: "https://playground.test/api/v1/tasks?q=it's",
      headers: [['X-Sandbox-Id', SANDBOX]],
      body: null,
    })
    expect(curl.split(' \\\n')[0]).toBe(`curl -i 'https://playground.test/api/v1/tasks?q=it'\\''s'`)
  })
})

describe('toFetch', () => {
  /** Runs the snippet with a fake fetch and returns what it was called with. */
  async function run(snippet: string, status = 200) {
    const calls: [string, RequestInit][] = []
    const fakeFetch = async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(status === 204 ? null : '{"ok":true}', { status })
    }
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
    const result = await new AsyncFunction(
      'fetch',
      `${snippet}\nreturn typeof data === 'undefined' ? deleted : data`,
    )(fakeFetch)
    return { calls, result }
  }

  it('writes a GET with only the headers', async () => {
    const snippet = toFetch(prepared({ method: 'GET', path: '/api/v1/tasks/stats', body: '' }))
    expect(snippet).toBe(
      [
        `const response = await fetch('https://playground.test/api/v1/tasks/stats', {`,
        '  headers: {',
        `    'X-Sandbox-Id': '${SANDBOX}',`,
        '  },',
        '})',
        'const data = await response.json()',
      ].join('\n'),
    )
    const { calls, result } = await run(snippet)
    expect(calls).toEqual([
      ['https://playground.test/api/v1/tasks/stats', { headers: { 'X-Sandbox-Id': SANDBOX } }],
    ])
    expect(result).toEqual({ ok: true })
  })

  it('writes the body as JSON.stringify of a readable literal that sends the same JSON', async () => {
    const body = { title: `Revisar el 'deploy' y el "build"`, priority: 'high', tags: ['a\\b'] }
    const request = prepared({ method: 'POST', path: '/api/v1/tasks', body: JSON.stringify(body, null, 2) })
    const snippet = toFetch(request)
    expect(snippet).toContain(`  method: 'POST',`)
    expect(snippet).toContain(`    title: 'Revisar el \\'deploy\\' y el "build"',`)
    expect(snippet).toContain('  body: JSON.stringify({\n')

    const { calls } = await run(snippet, 201)
    const [, init] = calls[0] ?? []
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', 'X-Sandbox-Id': SANDBOX })
    expect(init?.body).toBe(request.body)
  })

  it('reads no JSON after a DELETE, which answers 204 with no body', async () => {
    const snippet = toFetch(prepared({ method: 'DELETE', path: `/api/v1/tasks/${TASK}`, body: '' }))
    expect(snippet).toContain(`  method: 'DELETE',`)
    expect(snippet.endsWith('const deleted = response.status === 204')).toBe(true)
    const { result } = await run(snippet, 204)
    expect(result).toBe(true)
  })

  it('carries a body that is not JSON yet as a string, still valid JavaScript', async () => {
    const snippet = toFetch({
      method: 'POST',
      path: '/api/v1/tasks',
      url: 'https://playground.test/api/v1/tasks',
      headers: [['Content-Type', 'application/json']],
      body: "{'title': 'x'}",
    })
    expect(snippet).toContain(`  body: '{\\'title\\': \\'x\\'}',`)
    const { calls } = await run(snippet)
    expect(calls[0]?.[1].body).toBe("{'title': 'x'}")
  })
})
