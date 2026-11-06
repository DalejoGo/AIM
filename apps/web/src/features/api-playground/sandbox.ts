/**
 * The visitor's sandbox id: a UUID of their own, sent in X-Sandbox-Id. The API keeps one in-memory space per id
 * (3 sample tasks to start), so it lives in sessionStorage: a reload keeps the same tasks, a new tab starts over.
 */

export const SANDBOX_KEY = 'aim-playground-sandbox'

/** The part of Storage this module uses, so tests can pass a fake or one that throws. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

/** sessionStorage, or `null` when the browser blocks it (private modes, disabled storage, server render). */
export function sessionStore(): KeyValueStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

type RandomSource = Pick<Crypto, 'getRandomValues'> & { randomUUID?: () => string }

/**
 * A random v4 UUID. `crypto.randomUUID` only exists in secure contexts (https, localhost); elsewhere the same
 * format is built from `getRandomValues`, which every browser has.
 */
export function randomUuid(source: RandomSource = crypto): string {
  if (typeof source.randomUUID === 'function') return source.randomUUID()
  const bytes = source.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Reads a key, treating a storage that throws like an empty one. */
export function readItem(storage: KeyValueStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** Writes a key; a full or blocked storage only means the value is not remembered. */
export function writeItem(storage: KeyValueStorage | null, key: string, value: string | null): void {
  try {
    if (value === null) storage?.removeItem(key)
    else storage?.setItem(key, value)
  } catch {
    // Nothing to do: the page keeps working with the value in memory.
  }
}

/** The stored sandbox id, or a new one (stored when possible) when there is none or it is not a UUID. */
export function loadSandboxId(storage: KeyValueStorage | null, newId: () => string = randomUuid): string {
  const stored = readItem(storage, SANDBOX_KEY)
  if (isUuid(stored)) return stored.toLowerCase()
  return renewSandboxId(storage, newId)
}

/** "Empezar de cero": a new id, so the API creates a fresh sandbox with the sample tasks. */
export function renewSandboxId(storage: KeyValueStorage | null, newId: () => string = randomUuid): string {
  const id = newId().toLowerCase()
  writeItem(storage, SANDBOX_KEY, id)
  return id
}
