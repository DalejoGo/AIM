import type { PreparedRequest } from './request'

/**
 * The current request as code to copy: curl for a terminal (bash, zsh, Git Bash) and fetch for JavaScript.
 * Every value is quoted for its language, so a title with ' or " still produces a command that works.
 */

/** A POSIX shell word in single quotes: inside them only ' needs care, closed, escaped and reopened. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

const JS_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  "'": "\\'",
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
  '\v': '\\v',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
}

/** A JavaScript string literal in single quotes, with every character that could break it escaped. */
export function jsString(value: string): string {
  // \p{Cc}: control characters, written as \u00XX unless they have a short escape above.
  const escaped = value.replace(/[\\'\u2028\u2029\p{Cc}]/gu, (char) => {
    const short = JS_ESCAPES[char]
    if (short) return short
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  })
  return `'${escaped}'`
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/** An object key as JavaScript writes it. `__proto__` goes computed, or it would set the prototype instead. */
export function jsKey(key: string): string {
  if (key === '__proto__') return `[${jsString(key)}]`
  return IDENTIFIER.test(key) ? key : jsString(key)
}

/** A parsed JSON value as a JavaScript literal, indented like the rest of the snippet. */
export function jsLiteral(value: unknown, indent = ''): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return jsString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const inner = `${indent}  `
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[\n${value.map((item) => `${inner}${jsLiteral(item, inner)},`).join('\n')}\n${indent}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    const lines = entries.map(([key, item]) => `${inner}${jsKey(key)}: ${jsLiteral(item, inner)},`)
    return `{\n${lines.join('\n')}\n${indent}}`
  }
  return 'null'
}

/** The parsed body, or `undefined` while it is not valid JSON (the snippets then carry the text as typed). */
function parsedBody(body: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(body) }
  } catch {
    return undefined
  }
}

export function toCurl(request: PreparedRequest): string {
  const first = request.method === 'GET' ? 'curl -i' : `curl -i -X ${request.method}`
  const lines = [`${first} ${shellQuote(request.url)}`]
  for (const [name, value] of request.headers) lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`)
  if (request.body !== null) lines.push(`  --data ${shellQuote(request.body)}`)
  return lines.join(' \\\n')
}

export function toFetch(request: PreparedRequest): string {
  const options: string[] = []
  if (request.method !== 'GET') options.push(`  method: ${jsString(request.method)},`)
  if (request.headers.length > 0) {
    const headers = request.headers.map(([name, value]) => `    ${jsKey(name)}: ${jsString(value)},`)
    options.push(`  headers: {\n${headers.join('\n')}\n  },`)
  }
  if (request.body !== null) {
    const parsed = parsedBody(request.body)
    options.push(
      parsed
        ? `  body: JSON.stringify(${jsLiteral(parsed.value, '  ')}),`
        : `  body: ${jsString(request.body)},`,
    )
  }
  const call = `const response = await fetch(${jsString(request.url)}, {\n${options.join('\n')}\n})`
  // DELETE answers 204 with no body: reading JSON there would throw.
  const read =
    request.method === 'DELETE'
      ? 'const deleted = response.status === 204'
      : 'const data = await response.json()'
  return `${call}\n${read}`
}
