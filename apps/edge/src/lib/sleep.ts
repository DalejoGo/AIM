import type { Sleep } from '../deps'

/** A timer that also ends when `signal` aborts (the visitor closed the page), so nothing waits for nobody. */
export const sleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, Math.max(0, ms))
    signal?.addEventListener('abort', done, { once: true })
  })
