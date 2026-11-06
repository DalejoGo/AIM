import { describe, expect, it } from 'vitest'
import { buildHistory, clip, MAX_MESSAGE_LENGTH, MAX_MESSAGES, normalizeContent, type Turn } from './history'

const user = (content: string): Turn => ({ role: 'user', content })
const assistant = (content: string): Turn => ({ role: 'assistant', content })

/** n complete exchanges (question and answer), numbered from 1. */
const exchanges = (n: number): Turn[] =>
  Array.from({ length: n }, (_, i) => [user(`pregunta ${i + 1}`), assistant(`respuesta ${i + 1}`)]).flat()

describe('normalizeContent', () => {
  it('trims, turns CRLF and CR into LF and drops control characters but line breaks and tabs', () => {
    expect(normalizeContent('  hola\r\nmundo\rya\u0007\u0000 \t x​  ')).toBe('hola\nmundo\nya \t x​')
  })

  it('leaves nothing of a message made of spaces and control characters', () => {
    expect(normalizeContent(' \n\u0001\t ')).toBe('')
  })
})

describe('clip', () => {
  it('keeps a text that fits', () => {
    expect(clip('hola', 4)).toBe('hola')
  })

  it('cuts a long text to the limit, ending in an ellipsis', () => {
    const cut = clip('a'.repeat(1200), 1000)
    expect(cut).toHaveLength(1000)
    expect(cut.endsWith('a…')).toBe(true)
  })

  it('does not leave spaces before the ellipsis', () => {
    expect(clip('una frase', 5)).toBe('una…')
  })

  it('never splits an emoji', () => {
    // "🙂" takes two UTF-16 units: cutting after the first would leave half a character.
    const cut = clip(`${'a'.repeat(8)}🙂🙂`, 10)
    expect(cut).toBe(`${'a'.repeat(8)}…`)
    expect(cut.length).toBeLessThanOrEqual(10)
  })
})

describe('buildHistory', () => {
  it('sends a single question as is', () => {
    expect(buildHistory([user('¿Cuánto cuesta una página web?')])).toEqual([
      user('¿Cuánto cuesta una página web?'),
    ])
  })

  it('returns nothing when there is no question', () => {
    expect(buildHistory([])).toEqual([])
    expect(buildHistory([assistant('Hola')])).toEqual([])
  })

  it('keeps the last 10 messages, starting and ending with the visitor', () => {
    const history = buildHistory([...exchanges(6), user('pregunta 7')])
    // 13 turns: the last 10 would start with an answer, so it is dropped too.
    expect(history).toHaveLength(9)
    expect(history[0]).toEqual(user('pregunta 3'))
    expect(history.at(-1)).toEqual(user('pregunta 7'))
  })

  it('never sends more than 10, even when the turns do not alternate', () => {
    const turns = Array.from({ length: 12 }, (_, i) => user(`${i}`))
    expect(buildHistory(turns)).toEqual([user('11')])
    const answered = [...exchanges(5), user('6')]
    // 11 turns: the window of 10 starts with an answer, which the API would drop anyway.
    expect(buildHistory(answered)).toEqual(answered.slice(2))
  })

  it('drops answers after the last question', () => {
    expect(buildHistory([user('a'), assistant('b')])).toEqual([user('a')])
    expect(buildHistory([user('a'), assistant('b'), user('c'), assistant('')])).toEqual([
      user('a'),
      assistant('b'),
      user('c'),
    ])
  })

  it('keeps only the latest of two questions in a row (the first got no answer)', () => {
    expect(buildHistory([user('a'), assistant('b'), user('sin respuesta'), user('otra vez')])).toEqual([
      user('a'),
      assistant('b'),
      user('otra vez'),
    ])
  })

  it('skips empty turns, such as an answer stopped before it began', () => {
    expect(buildHistory([user('a'), assistant('   '), user('b')])).toEqual([user('b')])
  })

  it('normalizes every turn', () => {
    expect(buildHistory([user('  hola\r\n  ')])).toEqual([user('hola')])
  })

  it('clips long answers so every turn fits the API limit', () => {
    const long = 'Te cuento. '.repeat(200)
    const history = buildHistory([user('a'), assistant(long), user('b')])
    expect(history[1]?.content.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH)
    expect(history[1]?.content.endsWith('…')).toBe(true)
  })

  it('accepts other limits', () => {
    expect(buildHistory([...exchanges(3), user('d')], { maxMessages: 3, maxLength: 5 })).toEqual([
      user('preg…'),
      assistant('resp…'),
      user('d'),
    ])
  })

  it('always gives what the API accepts, for any mix of turns', () => {
    // Deterministic pseudo-random conversations (mulberry32).
    let seed = 42
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pieces = ['', '   ', 'hola', 'x'.repeat(1500), '¿y el precio?\r\n', '🙂'.repeat(600)]
    for (let run = 0; run < 300; run++) {
      const turns = Array.from({ length: Math.floor(random() * 30) }, () => ({
        role: random() < 0.5 ? ('user' as const) : ('assistant' as const),
        content: pieces[Math.floor(random() * pieces.length)] ?? '',
      }))
      const history = buildHistory(turns)
      if (history.length === 0) continue
      expect(history.length).toBeLessThanOrEqual(MAX_MESSAGES)
      expect(history[0]?.role).toBe('user')
      expect(history.at(-1)?.role).toBe('user')
      history.forEach((turn, i) => {
        expect(turn.content.trim()).toBe(turn.content)
        expect(turn.content.length).toBeGreaterThan(0)
        expect(turn.content.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH)
        if (i > 0) expect(turn.role).not.toBe(history[i - 1]?.role)
      })
    }
  })
})
