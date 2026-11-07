import { AutomationFlowLead, AutomationStepReport } from '@aim/contracts'
import { describe, expect, it } from 'vitest'
import { fingerprint } from '../scripts/fingerprint.mjs'
import { LEAD_FLOW_NAME, runLeadFlow } from '../src/index'
import { leadDemoWorkflow } from '../src/workflow'
import leads from './fixtures/leads.json'
import recording from './fixtures/n8n-runs.json'

// The edge's flow against a real n8n: test/fixtures/n8n-runs.json is what n8n reported for each lead of
// leads.json, recorded with scripts/record-n8n.mjs. The only difference allowed is `received`, which n8n
// fills with its execution id and the edge with the workflow's name.

const byId = new Map(recording.runs.map((run) => [run.id, run.steps]))

describe('parity with n8n', () => {
  it('was recorded from the current workflow', () => {
    // Fails after a change to a node or a connection: record again (automations/README.md).
    expect(recording.fingerprint).toBe(fingerprint(leadDemoWorkflow))
  })

  it('has a recording for every lead', () => {
    expect([...byId.keys()]).toEqual(leads.map((fixture) => fixture.id))
  })

  it.each(leads)('$id: the same steps, with the same data', ({ id, runId, lead }) => {
    const n8n = byId.get(id) ?? []
    const edge = runLeadFlow(AutomationFlowLead.parse(lead), runId)
    expect(edge.map((report) => report.step)).toEqual(n8n.map((report) => report.step))
    const [received, ...rest] = edge
    expect(received).toEqual({ step: 'received', data: { flow: LEAD_FLOW_NAME } })
    expect(rest).toEqual(n8n.slice(1))
  })

  it.each(leads)('$id: every step n8n sent fits the contract', ({ id }) => {
    for (const report of (byId.get(id) ?? []).slice(1)) {
      expect(AutomationStepReport.parse(report)).toEqual(report)
    }
  })
})
