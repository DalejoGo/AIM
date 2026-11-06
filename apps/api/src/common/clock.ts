/** Source of the current time, injected so tests can move it forward (sandbox expiry, overdue tasks). */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number
}

export const CLOCK = Symbol('Clock')

export const systemClock: Clock = { now: () => Date.now() }
