import type {
  AutomationCheck,
  AutomationFactor,
  AutomationFlowLead,
  AutomationStepReport,
  AutomationTier,
} from '@aim/contracts'
import { LEAD_FLOW_NAME, type LeadFlowRules, leadFlowRules } from './workflow'

// "Contacto → lead calificado", node by node, exactly as n8n evaluates workflows/lead-demo.json. Each block
// names the node it mirrors; the steps it returns are the bodies of the workflow's "Reportar" nodes.
// test/parity.test.ts checks it against what a real n8n reported for the same leads (test/fixtures).

/** "Preparar ejecución": the lead trimmed and the template variables of the reply. */
function prepare(input: AutomationFlowLead) {
  const lead = {
    name: input.name.trim(),
    company: (input.company ?? '').trim(),
    email: input.email.trim().toLowerCase(),
    service: input.service,
    serviceTitle: input.serviceTitle.trim(),
    budget: input.budget,
    timeline: input.timeline,
    message: input.message.trim(),
  }
  const vars: Record<string, string> = {
    firstName: lead.name.split(/\s+/)[0] ?? '',
    service: lead.serviceTitle,
    fromCompany: lead.company ? ` desde ${lead.company}` : '',
  }
  return { lead, vars }
}

type Lead = ReturnType<typeof prepare>['lead']

/** "Validar". */
function validate(R: LeadFlowRules, lead: Lead): AutomationCheck[] {
  const domainParts = (lead.email.split('@').pop() ?? '').split('.')
  const links = lead.message.match(new RegExp(R.validation.linkPattern, 'gi')) ?? []
  const labels = R.validation.labels
  return [
    {
      id: 'corporate_email',
      label: labels.corporate_email,
      ok: !domainParts.some((part) => R.validation.freeEmailProviders.includes(part)),
    },
    {
      id: 'detailed_message',
      label: labels.detailed_message,
      ok: lead.message.length >= R.validation.minMessageLength,
    },
    { id: 'company_given', label: labels.company_given, ok: lead.company.length > 0 },
    {
      id: 'no_suspicious_links',
      label: labels.no_suspicious_links,
      ok: links.length <= R.validation.maxLinks,
    },
  ]
}

/** A key of a rules table, never an inherited one ("constructor" is not a budget). */
const pick = <T>(table: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined

/** "Calificar". */
function factors(R: LeadFlowRules, lead: Lead, checks: AutomationCheck[]): AutomationFactor[] {
  const { scoring, factorLabels } = R
  const corporate = checks.find((check) => check.id === 'corporate_email')?.ok === true
  return [
    {
      label: `${factorLabels.budget}: ${pick(R.budgetLabels, lead.budget) ?? lead.budget}`,
      points: pick(scoring.budget, lead.budget) ?? 0,
    },
    {
      label: `${factorLabels.timeline}: ${pick(R.timelineLabels, lead.timeline) ?? lead.timeline}`,
      points: pick(scoring.timeline, lead.timeline) ?? 0,
    },
    {
      label: `${factorLabels.service}: ${lead.serviceTitle}`,
      points: pick(scoring.service, lead.service) ?? scoring.service.other,
    },
    corporate
      ? { label: factorLabels.corporateEmail, points: scoring.corporateEmail }
      : { label: factorLabels.personalEmail, points: 0 },
    lead.message.length >= scoring.detailedMessageLength
      ? { label: factorLabels.detailedMessage, points: scoring.detailedMessage }
      : { label: factorLabels.shortMessage, points: 0 },
  ]
}

/** "Calcular nivel": the score is clamped to 0–max; the tier uses the raw sum, as the node does. */
function grade(R: LeadFlowRules, list: AutomationFactor[]): { score: number; tier: AutomationTier } {
  const sum = list.reduce((total, factor) => total + factor.points, 0)
  const { tiers } = R.scoring
  return {
    score: Math.max(0, Math.min(R.scoring.max, sum)),
    tier: sum >= tiers.hot ? 'hot' : sum >= tiers.warm ? 'warm' : 'cold',
  }
}

/** "Redactar respuesta": `{name}` placeholders filled in; unknown ones stay as they are. */
const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => pick(vars, key) ?? match)

/**
 * Runs the flow for one lead and returns its steps in order: received, validated, then either done
 * (rejected) or scored, routed, drafted, recorded and done (accepted). Pure and synchronous: no I/O.
 */
export function runLeadFlow(
  input: AutomationFlowLead,
  runId: string,
  R: LeadFlowRules = leadFlowRules,
): AutomationStepReport[] {
  const { lead, vars } = prepare(input)
  const steps: AutomationStepReport[] = [{ step: 'received', data: { flow: LEAD_FLOW_NAME } }]

  // "Validar", "Resumir validación" and "¿Pasa la validación?"
  const checks = validate(R, lead)
  const valid = checks
    .filter((check) => R.validation.blockingChecks.includes(check.id))
    .every((check) => check.ok)
  steps.push({ step: 'validated', data: { valid, checks } })
  if (!valid) {
    steps.push({ step: 'done', data: { outcome: 'rejected' } })
    return steps
  }

  const list = factors(R, lead, checks)
  const { score, tier } = grade(R, list)
  steps.push({ step: 'scored', data: { score, tier, factors: list } })

  // "Enrutar"
  const route = R.routes[tier]
  steps.push({ step: 'routed', data: { route: route.route, label: route.label, sla: route.sla } })

  const draft = R.drafts[route.route]
  steps.push({
    step: 'drafted',
    data: {
      subject: fill(draft.subject, vars).slice(0, 160),
      body: fill(draft.body.join('\n\n'), vars).slice(0, 2000),
    },
  })

  // "Registrar"
  steps.push({ step: 'recorded', data: { reference: `AIM-${runId.slice(0, 8).toUpperCase()}` } })
  steps.push({ step: 'done', data: { outcome: 'accepted' } })
  return steps
}
