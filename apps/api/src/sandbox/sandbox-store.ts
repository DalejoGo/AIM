import type { Clock } from '../common/clock.js'

export interface SandboxStoreOptions {
  ttlMs: number
  maxSandboxes: number
}

interface Entry<T> {
  data: T
  lastUsedAt: number
}

/**
 * In-memory sandboxes keyed by visitor id, with a sliding TTL and an LRU cap.
 *
 * The Map keeps insertion order and every access re-inserts its key, so entries are always sorted from least
 * to most recently used: expired ones sit at the front (the TTL is the same for all) and so does the one to
 * evict. Both checks are O(1) per dropped entry, with no timers to clean up.
 */
export class SandboxStore<T> {
  private readonly entries = new Map<string, Entry<T>>()

  constructor(
    private readonly options: SandboxStoreOptions,
    private readonly clock: Clock,
    private readonly create: (now: number) => T,
  ) {}

  /** The sandbox for `id`, created fresh when it is new or expired. Using it renews its TTL. */
  get(id: string): T {
    const now = this.clock.now()
    this.dropExpired(now)

    const entry = this.entries.get(id)
    this.entries.delete(id)
    const data = entry ? entry.data : this.create(now)
    this.entries.set(id, { data, lastUsedAt: now })

    while (this.entries.size > this.options.maxSandboxes) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
    return data
  }

  has(id: string): boolean {
    const entry = this.entries.get(id)
    return entry !== undefined && !this.isExpired(entry, this.clock.now())
  }

  get size(): number {
    this.dropExpired(this.clock.now())
    return this.entries.size
  }

  private dropExpired(now: number): void {
    for (const [id, entry] of this.entries) {
      if (!this.isExpired(entry, now)) break
      this.entries.delete(id)
    }
  }

  private isExpired(entry: Entry<T>, now: number): boolean {
    return now - entry.lastUsedAt >= this.options.ttlMs
  }
}
