import type { AutomationStatusState } from '@aim/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWakeWatch, fetchStatus, formatClock, STATUS_PATH, WAKE_GIVE_UP_MS, WAKE_POLL_MS } from './wake'

type Answer = AutomationStatusState | null | 'throw'

/** A status check that answers from a script (the last answer repeats) and records each call. */
function scripted(...answers: Answer[]) {
  const signals: AbortSignal[] = []
  const check = vi.fn(async (signal: AbortSignal) => {
    signals.push(signal)
    const answer = answers[Math.min(signals.length - 1, answers.length - 1)] ?? null
    if (answer === 'throw') throw new Error('network')
    return answer
  })
  return { check, signals }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createWakeWatch', () => {
  it('shows ready after one check and asks no more', async () => {
    const { check } = scripted('ready')
    const watch = createWakeWatch({ check })
    await watch.start()
    expect(watch.view.value).toBe('ready')
    await vi.advanceTimersByTimeAsync(WAKE_POLL_MS * 4)
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('asks every 5 s while n8n wakes up, counts the wait and stops once it is ready', async () => {
    const { check } = scripted('waking', 'waking', 'ready')
    const watch = createWakeWatch({ check })
    await watch.start()
    expect(watch.view.value).toBe('waking')
    expect(watch.elapsedMs.value).toBe(0)

    await vi.advanceTimersByTimeAsync(3_000)
    expect(watch.elapsedMs.value).toBe(3_000)
    expect(check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(check).toHaveBeenCalledTimes(2)
    expect(watch.view.value).toBe('waking')
    await vi.advanceTimersByTimeAsync(WAKE_POLL_MS)
    expect(check).toHaveBeenCalledTimes(3)
    expect(watch.view.value).toBe('ready')

    const shown = watch.elapsedMs.value
    await vi.advanceTimersByTimeAsync(WAKE_POLL_MS * 4)
    expect(check).toHaveBeenCalledTimes(3)
    expect(watch.elapsedMs.value).toBe(shown)
  })

  it.each([
    ['the demo is disabled', 'disabled'],
    ['the API answered something else', null],
    ['the request failed', 'throw'],
  ] as const)('hides and stops when %s', async (_, answer) => {
    const { check } = scripted(answer)
    const watch = createWakeWatch({ check })
    await watch.start()
    expect(watch.view.value).toBe('hidden')
    await vi.advanceTimersByTimeAsync(WAKE_POLL_MS * 3)
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('hides a waking indicator when a later check fails', async () => {
    const { check } = scripted('waking', 'throw')
    const watch = createWakeWatch({ check })
    await watch.start()
    expect(watch.view.value).toBe('waking')
    await vi.advanceTimersByTimeAsync(WAKE_POLL_MS)
    expect(watch.view.value).toBe('hidden')
    await vi.advanceTimersByTimeAsync(WAKE_POLL_MS * 3)
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('gives up after the wake timeout, as a run would', async () => {
    const { check } = scripted('waking')
    const watch = createWakeWatch({ check })
    await watch.start()
    await vi.advanceTimersByTimeAsync(WAKE_GIVE_UP_MS - 1)
    expect(watch.view.value).toBe('waking')
    const asked = check.mock.calls.length
    expect(asked).toBe(Math.floor((WAKE_GIVE_UP_MS - 1) / WAKE_POLL_MS) + 1)

    await vi.advanceTimersByTimeAsync(WAKE_POLL_MS)
    expect(watch.view.value).toBe('hidden')
    await vi.advanceTimersByTimeAsync(WAKE_POLL_MS * 4)
    expect(check).toHaveBeenCalledTimes(asked + 1)
  })

  it('does not ask while the tab is hidden, and asks at once when it is back', async () => {
    const { check } = scripted('waking', 'waking', 'ready')
    const watch = createWakeWatch({ check })
    await watch.start()
    await watch.setPageHidden(true)
    await vi.advanceTimersByTimeAsync(WAKE_POLL_MS * 6)
    expect(check).toHaveBeenCalledTimes(1)
    expect(watch.elapsedMs.value).toBe(0)

    await watch.setPageHidden(false)
    expect(check).toHaveBeenCalledTimes(2)
    expect(watch.view.value).toBe('waking')
    expect(watch.elapsedMs.value).toBe(WAKE_POLL_MS * 6)
    await vi.advanceTimersByTimeAsync(WAKE_POLL_MS)
    expect(watch.view.value).toBe('ready')
  })

  it('still asks once in a background tab: that request is what wakes n8n up', async () => {
    const { check } = scripted('waking', 'ready')
    const watch = createWakeWatch({ check })
    await watch.setPageHidden(true)
    await watch.start()
    expect(check).toHaveBeenCalledTimes(1)
    expect(watch.view.value).toBe('waking')
    await vi.advanceTimersByTimeAsync(WAKE_POLL_MS * 3)
    expect(check).toHaveBeenCalledTimes(1)
    await watch.setPageHidden(false)
    expect(watch.view.value).toBe('ready')
  })

  it('a tab hidden while a check is on its way schedules nothing until it is back', async () => {
    let answer: (state: AutomationStatusState) => void = () => {}
    const check = vi.fn(
      () =>
        new Promise<AutomationStatusState>((resolve) => {
          answer = resolve
        }),
    )
    const watch = createWakeWatch({ check })
    const first = watch.start()
    await watch.setPageHidden(true)
    answer('waking')
    await first
    await vi.advanceTimersByTimeAsync(WAKE_POLL_MS * 3)
    expect(check).toHaveBeenCalledTimes(1)
    const back = watch.setPageHidden(false)
    expect(check).toHaveBeenCalledTimes(2)
    answer('ready')
    await back
    expect(watch.view.value).toBe('ready')
  })

  it('stops for good when a run starts: aborts the check on its way and hides', async () => {
    let answer: (state: AutomationStatusState) => void = () => {}
    const signals: AbortSignal[] = []
    const check = vi.fn(
      (signal: AbortSignal) =>
        new Promise<AutomationStatusState>((resolve) => {
          signals.push(signal)
          answer = resolve
        }),
    )
    const watch = createWakeWatch({ check })
    const first = watch.start()
    answer('waking')
    await first
    await vi.advanceTimersByTimeAsync(WAKE_POLL_MS)
    expect(check).toHaveBeenCalledTimes(2)

    watch.stop()
    expect(signals[1]?.aborted).toBe(true)
    expect(watch.view.value).toBe('hidden')
    answer('ready')
    await vi.advanceTimersByTimeAsync(WAKE_POLL_MS * 3)
    expect(watch.view.value).toBe('hidden')
    expect(check).toHaveBeenCalledTimes(2)
    await watch.setPageHidden(true)
    await watch.setPageHidden(false)
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('starts only once', async () => {
    const { check } = scripted('ready')
    const watch = createWakeWatch({ check })
    await watch.start()
    await watch.start()
    expect(check).toHaveBeenCalledTimes(1)
  })
})

describe('formatClock', () => {
  it('shows minutes and seconds', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(7_900)).toBe('0:07')
    expect(formatClock(83_000)).toBe('1:23')
    expect(formatClock(-5)).toBe('0:00')
  })
})

describe('fetchStatus', () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('asks GET /api/automation/status, never from the cache', async () => {
    const calls: { path: string; init: RequestInit }[] = []
    const signal = new AbortController().signal
    const state = await fetchStatus(signal, async (path, init) => {
      calls.push({ path, init })
      return json(200, { state: 'waking' })
    })
    expect(state).toBe('waking')
    expect(calls).toEqual([
      {
        path: STATUS_PATH,
        init: {
          method: 'GET',
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
          signal,
        },
      },
    ])
  })

  it.each(['ready', 'waking', 'disabled'] as const)('reads %s', async (state) => {
    expect(await fetchStatus(new AbortController().signal, async () => json(200, { state }))).toBe(state)
  })

  it.each([
    ['an unknown state', async () => json(200, { state: 'asleep' })],
    ['a body that is not JSON', async () => new Response('<html>', { status: 200 })],
    ['a 404 (no API here)', async () => json(404, { error: 'not_found', message: 'No existe.' })],
    ['a 500', async () => json(500, { error: 'internal', message: 'Falló.' })],
    [
      'no connection',
      async () => {
        throw new TypeError('Failed to fetch')
      },
    ],
  ])('turns %s into null', async (_, reply) => {
    expect(await fetchStatus(new AbortController().signal, reply)).toBeNull()
  })
})
