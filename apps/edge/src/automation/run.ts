import { runLeadFlow } from '@aim/automations'
import {
  type AutomationFlowLead,
  AutomationStepEvent,
  type AutomationStreamEventName,
  type AutomationStreamEvents,
} from '@aim/contracts'
import type { SSEStreamingApi } from 'hono/streaming'
import type { z } from 'zod'
import { log } from '../lib/log'

// What POST /api/automation/runs streams once the visitor passed Turnstile (DEC-023). The flow,
// designed in n8n (automations/workflows/lead-demo.json), runs right here in memory with @aim/automations: no
// external service, no database, under a millisecond. The stream is `run`, one `step` per step, then `done`;
// or `run` and `error` when something unexpected fails.

export const INTERNAL_ERROR_MESSAGE =
  'Algo falló de nuestro lado durante la ejecución. Inténtalo de nuevo en unos minutos.'

type Payloads = { [E in AutomationStreamEventName]: z.output<(typeof AutomationStreamEvents)[E]> }

/** One SSE event of a run, its payload typed by its name. */
export type RunEvent = {
  [E in AutomationStreamEventName]: { event: E; data: Payloads[E] }
}[AutomationStreamEventName]

export interface RunInput {
  runId: string
  /** The visitor's lead and the service's visible name. */
  lead: AutomationFlowLead
  /** Times the flow: `atMs` and `totalMs` are milliseconds since it started. */
  now: () => Date
}

/**
 * Runs the flow and returns every event of the stream, in order. The flow hands back all its steps at once, so
 * they share one `atMs`: the time the whole flow took. Never throws: a failure is logged and becomes `error`.
 */
export function runEvents({ runId, lead, now }: RunInput): RunEvent[] {
  const run: RunEvent = { event: 'run', data: { runId } }
  try {
    const startedAt = now().getTime()
    const reports = runLeadFlow(lead, runId)
    const atMs = Math.max(0, now().getTime() - startedAt)
    // Each step is read through the contract, so what reaches the browser always has its shape (the flow's
    // labels and replies come from the workflow file, which is edited in n8n).
    const steps = reports.map((report) => AutomationStepEvent.parse({ ...report, atMs }))
    const last = steps.at(-1)
    if (last?.step !== 'done') throw new Error(`the flow ended on ${last?.step ?? 'no step'} instead of done`)
    return [
      run,
      ...steps.map((data): RunEvent => ({ event: 'step', data })),
      { event: 'done', data: { outcome: last.data.outcome, totalMs: atMs } },
    ]
  } catch (err) {
    log.error('automation run failed', err)
    return [run, { event: 'error', data: { code: 'internal', message: INTERNAL_ERROR_MESSAGE } }]
  }
}

/** Writes the events as Server-Sent Events, stopping if the visitor already left. */
export async function writeEvents(stream: SSEStreamingApi, events: readonly RunEvent[]): Promise<void> {
  for (const { event, data } of events) {
    if (stream.aborted) return
    await stream.writeSSE({ event, data: JSON.stringify(data) })
  }
}
