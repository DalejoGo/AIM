import { describe, expect, it, vi } from 'vitest'
import { SandboxStore } from '../src/sandbox/sandbox-store.js'
import { FakeClock, MINUTE } from './helpers.js'

function setup(maxSandboxes = 3) {
  const clock = new FakeClock()
  const create = vi.fn((now: number) => ({ createdAt: now, items: [] as string[] }))
  const store = new SandboxStore({ ttlMs: 30 * MINUTE, maxSandboxes }, clock, create)
  return { clock, create, store }
}

describe('SandboxStore', () => {
  it('creates a sandbox on first use and returns the same one afterwards', () => {
    const { store, create, clock } = setup()
    const first = store.get('a')
    first.items.push('x')

    expect(store.get('a')).toBe(first)
    expect(store.get('a').items).toEqual(['x'])
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(clock.now())
  })

  it('keeps sandboxes apart', () => {
    const { store } = setup()
    store.get('a').items.push('only in a')
    expect(store.get('b').items).toEqual([])
    expect(store.size).toBe(2)
  })

  it('expires a sandbox after the TTL without use', () => {
    const { store, clock, create } = setup()
    const first = store.get('a')

    clock.advance(30 * MINUTE - 1)
    expect(store.has('a')).toBe(true)
    clock.advance(1)
    expect(store.has('a')).toBe(false)
    expect(store.size).toBe(0)

    const second = store.get('a')
    expect(second).not.toBe(first)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('renews the TTL on every use (sliding expiry)', () => {
    const { store, clock } = setup()
    const first = store.get('a')
    for (let i = 0; i < 5; i++) {
      clock.advance(20 * MINUTE)
      expect(store.get('a')).toBe(first)
    }
  })

  it('drops only the expired sandboxes', () => {
    const { store, clock } = setup()
    store.get('old')
    clock.advance(20 * MINUTE)
    store.get('recent')
    clock.advance(15 * MINUTE)

    expect(store.has('old')).toBe(false)
    expect(store.has('recent')).toBe(true)
    expect(store.size).toBe(1)
  })

  it('evicts the least recently used sandbox past the cap', () => {
    const { store } = setup(3)
    const a = store.get('a')
    store.get('b')
    store.get('c')
    store.get('a') // "b" is now the least recently used.
    store.get('d')

    expect(store.size).toBe(3)
    expect(store.has('b')).toBe(false)
    expect(store.get('a')).toBe(a)
    expect(['c', 'd'].every((id) => store.has(id))).toBe(true)
  })

  it('never holds more than the cap', () => {
    const { store } = setup(500)
    for (let i = 0; i < 1200; i++) store.get(`sandbox-${i}`)
    expect(store.size).toBe(500)
    expect(store.has('sandbox-699')).toBe(false)
    expect(store.has('sandbox-700')).toBe(true)
  })
})
