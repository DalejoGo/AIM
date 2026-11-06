import { describe, expect, it } from 'vitest'
import {
  isUuid,
  type KeyValueStorage,
  loadSandboxId,
  randomUuid,
  readItem,
  renewSandboxId,
  SANDBOX_KEY,
  writeItem,
} from './sandbox'

const UUID_A = '0b6e7d2a-3f4c-4b8e-9a1d-5c2f8e7a6b10'
const UUID_B = '5d0f8a5e-8a39-4c55-9a43-0f5b8c1d2e3f'

function memoryStorage(
  initial: Record<string, string> = {},
): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

const throwing: KeyValueStorage = {
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError')
  },
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError')
  },
  removeItem: () => {
    throw new DOMException('blocked', 'SecurityError')
  },
}

describe('isUuid', () => {
  it('accepts UUIDs in any case and nothing else', () => {
    expect(isUuid(UUID_A)).toBe(true)
    expect(isUuid(UUID_A.toUpperCase())).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid(`${UUID_A}x`)).toBe(false)
    expect(isUuid(null)).toBe(false)
    expect(isUuid(42)).toBe(false)
  })
})

describe('randomUuid', () => {
  it('uses crypto.randomUUID when the browser has it', () => {
    expect(randomUuid({ randomUUID: () => UUID_A, getRandomValues: (a) => a })).toBe(UUID_A)
  })

  it('builds a v4 UUID from getRandomValues outside secure contexts', () => {
    const id = randomUuid({ getRandomValues: <T extends ArrayBufferView | null>(array: T) => array })
    expect(id).toBe('00000000-0000-4000-8000-000000000000')
    const random = randomUuid({ getRandomValues: (array) => crypto.getRandomValues(array) })
    expect(random).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('is a valid UUID with the real crypto', () => {
    expect(isUuid(randomUuid())).toBe(true)
    expect(randomUuid()).not.toBe(randomUuid())
  })
})

describe('loadSandboxId', () => {
  it('reuses the stored id, so a reload keeps the same sandbox', () => {
    const storage = memoryStorage({ [SANDBOX_KEY]: UUID_A.toUpperCase() })
    expect(loadSandboxId(storage, () => UUID_B)).toBe(UUID_A)
  })

  it('creates and stores a new id when there is none', () => {
    const storage = memoryStorage()
    expect(loadSandboxId(storage, () => UUID_B)).toBe(UUID_B)
    expect(storage.data.get(SANDBOX_KEY)).toBe(UUID_B)
  })

  it('replaces a stored value that is not a UUID', () => {
    const storage = memoryStorage({ [SANDBOX_KEY]: 'hola' })
    expect(loadSandboxId(storage, () => UUID_B)).toBe(UUID_B)
    expect(storage.data.get(SANDBOX_KEY)).toBe(UUID_B)
  })

  it('still works when the storage throws or does not exist', () => {
    expect(loadSandboxId(throwing, () => UUID_B)).toBe(UUID_B)
    expect(loadSandboxId(null, () => UUID_A)).toBe(UUID_A)
  })
})

describe('renewSandboxId', () => {
  it('always switches to a new id and stores it', () => {
    const storage = memoryStorage({ [SANDBOX_KEY]: UUID_A })
    expect(renewSandboxId(storage, () => UUID_B.toUpperCase())).toBe(UUID_B)
    expect(storage.data.get(SANDBOX_KEY)).toBe(UUID_B)
    expect(renewSandboxId(throwing, () => UUID_A)).toBe(UUID_A)
  })
})

describe('readItem and writeItem', () => {
  it('read and write, and remove with null', () => {
    const storage = memoryStorage()
    writeItem(storage, 'k', 'v')
    expect(readItem(storage, 'k')).toBe('v')
    writeItem(storage, 'k', null)
    expect(readItem(storage, 'k')).toBeNull()
  })

  it('swallow storage errors', () => {
    expect(readItem(throwing, 'k')).toBeNull()
    expect(() => writeItem(throwing, 'k', 'v')).not.toThrow()
    expect(() => writeItem(throwing, 'k', null)).not.toThrow()
    expect(readItem(null, 'k')).toBeNull()
  })
})
