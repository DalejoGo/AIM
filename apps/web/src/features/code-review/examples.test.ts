import { describe, expect, it } from 'vitest'
import { codeError, isLanguage, normalizeCode } from './code'
import { EXAMPLES } from './examples'

describe('examples', () => {
  it('are three, with unique ids, valid languages and code the API accepts as it is', () => {
    expect(EXAMPLES.map((e) => e.language)).toEqual(['typescript', 'python', 'javascript'])
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length)
    for (const example of EXAMPLES) {
      expect(isLanguage(example.language)).toBe(true)
      expect(codeError(example.code)).toBeNull()
      expect(normalizeCode(example.code)).toBe(example.code)
      expect(example.description).not.toMatch(/[.:]$/)
    }
  })

  const code = (id: string) => EXAMPLES.find((e) => e.id === id)?.code ?? ''

  it('TypeScript builds a SQL query by joining strings with the visitor input', () => {
    expect(code('typescript-sql')).toMatch(/"SELECT .* WHERE email = '" \+ email \+ "'"/)
    expect(code('typescript-sql')).toContain('req.query.email')
  })

  it('Python swallows every error and divides by the number of orders, which may be zero', () => {
    expect(code('python-except')).toMatch(/except Exception:\n\s+pass/)
    expect(code('python-except')).toContain('return total / len(orders)')
  })

  it('JavaScript awaits inside forEach and compares with ==', () => {
    expect(code('javascript-foreach')).toContain('users.forEach(async (user) => {')
    expect(code('javascript-foreach')).toMatch(/[^=!]== 0/)
    expect(code('javascript-foreach')).toContain('return sent')
  })
})
