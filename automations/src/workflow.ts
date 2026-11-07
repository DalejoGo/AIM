import { z } from 'zod'
import workflow from '../workflows/lead-demo.json'

// The n8n workflow exported to the repo (workflows/lead-demo.json) is the source of truth: its name and the
// "Reglas del flujo" node, read here, drive the flow the edge runs. Editing the rules in n8n and exporting
// them (README.md) changes the site; editing the logic of another node also needs src/lead-flow.ts.

/** The n8n node that holds every rule of the flow, as one JSON. */
export const RULES_NODE = 'Reglas del flujo'

const text = z.string().trim().min(1)
const points = z.number().int().min(-100).max(100)
const RouteRule = z.object({ route: z.enum(['call', 'proposal', 'nurture']), label: text, sla: text })
const Draft = z.object({ subject: text, body: z.array(z.string()).min(1) })

/** The JSON of the "Reglas del flujo" node. A rule the flow reads and the file lacks fails at load. */
export const LeadFlowRules = z.object({
  validation: z.object({
    freeEmailProviders: z.array(text),
    minMessageLength: z.number().int().nonnegative(),
    maxLinks: z.number().int().nonnegative(),
    linkPattern: text,
    blockingChecks: z.array(text),
    labels: z.object({
      corporate_email: text,
      detailed_message: text,
      company_given: text,
      no_suspicious_links: text,
    }),
  }),
  scoring: z.object({
    budget: z.record(z.string(), points),
    timeline: z.record(z.string(), points),
    service: z.object({ other: points }).catchall(points),
    corporateEmail: points,
    detailedMessage: points,
    detailedMessageLength: z.number().int().nonnegative(),
    max: z.number().int().min(0).max(100),
    tiers: z.object({ hot: z.number(), warm: z.number() }),
  }),
  factorLabels: z.object({
    budget: text,
    timeline: text,
    service: text,
    corporateEmail: text,
    personalEmail: text,
    detailedMessage: text,
    shortMessage: text,
  }),
  budgetLabels: z.record(z.string(), text),
  timelineLabels: z.record(z.string(), text),
  routes: z.object({ hot: RouteRule, warm: RouteRule, cold: RouteRule }),
  drafts: z.object({ call: Draft, proposal: Draft, nurture: Draft }),
})
export type LeadFlowRules = z.infer<typeof LeadFlowRules>

interface WorkflowNode {
  name: string
  type: string
  typeVersion: number
  parameters: Record<string, unknown>
}

interface Workflow {
  name: string
  nodes: WorkflowNode[]
  connections: Record<string, unknown>
}

export const leadDemoWorkflow = workflow as Workflow

/** The workflow's name in n8n, shown on the `received` step. */
export const LEAD_FLOW_NAME = text.parse(leadDemoWorkflow.name)

function readRules(source: Workflow): LeadFlowRules {
  const node = source.nodes.find((candidate) => candidate.name === RULES_NODE)
  const json = node?.parameters.jsonOutput
  if (typeof json !== 'string') throw new Error(`n8n workflow: node "${RULES_NODE}" has no JSON`)
  return LeadFlowRules.parse(JSON.parse(json))
}

export const leadFlowRules: LeadFlowRules = readRules(leadDemoWorkflow)
