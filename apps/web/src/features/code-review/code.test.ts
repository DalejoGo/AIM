import { CODE_REVIEW_LANGUAGES, CODE_REVIEW_MAX_LENGTH } from '@aim/contracts/limits'
import { describe, expect, it } from 'vitest'
import { codeError, isLanguage, LANGUAGES, MAX_CODE_LENGTH, normalizeCode } from './code'

describe('languages', () => {
  it('offers every language of the contract, in its order, with a readable name', () => {
    expect(LANGUAGES.map((l) => l.value)).toEqual([...CODE_REVIEW_LANGUAGES])
    expect(LANGUAGES.map((l) => l.label)).toEqual([
      'TypeScript',
      'JavaScript',
      'Python',
      'SQL',
      'Otro lenguaje',
    ])
  })

  it('tells a language of the contract from anything else', () => {
    expect(isLanguage('python')).toBe(true)
    expect(isLanguage('rust')).toBe(false)
    expect(isLanguage('Python')).toBe(false)
  })
})

describe('normalizeCode', () => {
  it('keeps indentation and tabs, and drops CRLF, control characters and blank edges', () => {
    expect(normalizeCode('\r\n  \r\n    def f(x):\r\n\treturn x\u0007 / 2   \n\n')).toBe(
      '    def f(x):\n\treturn x / 2',
    )
  })

  it('leaves clean code untouched', () => {
    const clean = 'const a = 1\n\nif (a == 1) {\n  run()\n}'
    expect(normalizeCode(clean)).toBe(clean)
  })
})

describe('codeError', () => {
  it('asks for code when there is none or only blanks', () => {
    for (const blank of ['', '   ', '\n\t\n'])
      expect(codeError(blank)).toBe('Pega el código que quieres revisar.')
  })

  it(`accepts up to ${CODE_REVIEW_MAX_LENGTH} characters, counted after cleaning`, () => {
    expect(MAX_CODE_LENGTH).toBe(CODE_REVIEW_MAX_LENGTH)
    expect(codeError('a'.repeat(MAX_CODE_LENGTH))).toBeNull()
    expect(codeError(`\n\n${'a'.repeat(MAX_CODE_LENGTH)}\n  `)).toBeNull()
    expect(codeError('a'.repeat(MAX_CODE_LENGTH + 1))).toContain(`hasta ${MAX_CODE_LENGTH} caracteres`)
  })
})
