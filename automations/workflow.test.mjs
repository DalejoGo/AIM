// Structure of automations/workflows/lead-demo.json against docs/AUTOMATIZACION.md (§2–3), without Docker.
// The expressions themselves run in the image build: scripts/prepare-image.sh fails unless the seven steps
// reach a stand-in of the site in order.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const workflow = JSON.parse(readFileSync(new URL('./workflows/lead-demo.json', import.meta.url), 'utf8'))
const byName = new Map(workflow.nodes.map((node) => [node.name, node]))
const ofType = (type) => workflow.nodes.filter((node) => node.type === `n8n-nodes-base.${type}`)
const reports = ofType('httpRequest')
const CONTEXT = "$('Preparar ejecución').first().json"

/** Next nodes on output `index` (an IF node: 0 = true, 1 = false). */
const next = (name, index = 0) => (workflow.connections[name]?.main?.[index] ?? []).map((link) => link.node)

/** The protocol step a report node sends, read from its JSON body. */
const stepOf = (node) => /step: '(\w+)'/.exec(node.parameters.jsonBody)?.[1]

/** Steps reported along a path from the webhook, taking `branch` at every IF. */
function reportedSteps(branch) {
  const steps = []
  const seen = new Set()
  let [current] = ofType('webhook').map((node) => node.name)
  while (current && !seen.has(current)) {
    seen.add(current)
    const node = byName.get(current)
    if (node.type === 'n8n-nodes-base.httpRequest') steps.push(stepOf(node))
    const isIf = node.type === 'n8n-nodes-base.if'
    // The request guard always takes "true": its false branch only stops the run.
    const index = isIf && current !== '¿Petición válida?' ? branch : 0
    const targets = next(current, index)
    assert.ok(targets.length <= 1, `${current} fans out`)
    current = targets[0]
  }
  return steps
}

/** Every string inside a value, recursively. */
const strings = (value) =>
  typeof value === 'string'
    ? [value]
    : value && typeof value === 'object'
      ? Object.values(value).flatMap(strings)
      : []

const rules = JSON.parse(byName.get('Reglas del flujo').parameters.jsonOutput)

describe('webhook', () => {
  it('is a single POST on aim-lead-demo that answers 202 right away', () => {
    const hooks = ofType('webhook')
    assert.equal(hooks.length, 1)
    const { parameters } = hooks[0]
    assert.equal(parameters.httpMethod, 'POST')
    assert.equal(parameters.path, 'aim-lead-demo')
    assert.equal(parameters.responseMode, 'onReceived')
    assert.deepEqual(parameters.options.responseCode.values, { responseCode: 'customCode', customCode: 202 })
  })
})

describe('step reports', () => {
  it('reports the accepted path in protocol order', () => {
    assert.deepEqual(reportedSteps(0), [
      'received',
      'validated',
      'scored',
      'routed',
      'drafted',
      'recorded',
      'done',
    ])
  })

  it('reports done right after validated when the lead is rejected', () => {
    assert.deepEqual(reportedSteps(1), ['received', 'validated', 'done'])
    const rejected = reports.find((node) => /outcome: 'rejected'/.test(node.parameters.jsonBody))
    const accepted = reports.find((node) => /outcome: 'accepted'/.test(node.parameters.jsonBody))
    assert.ok(rejected && accepted)
  })

  it('sends the execution id as text in received', () => {
    const received = reports.find((node) => stepOf(node) === 'received')
    assert.match(received.parameters.jsonBody, /execution: String\(\$execution\.id\)/)
  })

  it('uses only the run token and the origin from the environment', () => {
    const context = byName.get('Preparar ejecución').parameters.assignments.assignments
    const url = context.find((field) => field.name === 'callbackUrl').value
    assert.match(url, /^=\{\{ String\(\$env\.AIM_SITE_ORIGIN \?\? ''\)/)
    assert.match(url, /'\/api\/automation\/runs\/' \+ encodeURIComponent\(/)
    assert.match(url, /'\/events'/)
    for (const node of reports) {
      const { parameters } = node
      assert.equal(parameters.method, 'POST', node.name)
      assert.equal(parameters.url, `={{ ${CONTEXT}.callbackUrl }}`, node.name)
      assert.deepEqual(
        parameters.headerParameters.parameters,
        [{ name: 'Authorization', value: `=Bearer {{ ${CONTEXT}.callbackToken }}` }],
        node.name,
      )
      assert.equal(parameters.specifyBody, 'json', node.name)
    }
  })

  it('stops the run on any non-2xx: no retries, no redirects, 10 s timeout', () => {
    for (const node of reports) {
      assert.notEqual(node.retryOnFail, true, node.name)
      assert.ok(!node.onError || node.onError === 'stopWorkflow', node.name)
      assert.ok(!node.continueOnFail, node.name)
      assert.equal(node.parameters.options.timeout, 10000, node.name)
      assert.equal(node.parameters.options.redirect.redirect.followRedirects, false, node.name)
      assert.notEqual(node.parameters.options.response?.response?.neverError, true, node.name)
    }
  })

  it('reports nothing for a request without a valid runId and token', () => {
    assert.deepEqual(next('Preparar ejecución'), ['¿Petición válida?'])
    assert.deepEqual(next('¿Petición válida?', 1), ['Petición inválida'])
    assert.equal(byName.get('Petición inválida').type, 'n8n-nodes-base.stopAndError')
  })
})

describe('safety', () => {
  it('holds no credentials and no code nodes', () => {
    for (const node of workflow.nodes) {
      assert.equal(node.credentials, undefined, node.name)
      assert.ok(!/\.(code|function|functionItem|pythonCode|executeCommand|ssh)$/.test(node.type), node.name)
    }
  })

  it('writes no host anywhere', () => {
    const host = /https?:\/\/[\w-]+(\.[\w-]+)+|localhost|127\.0\.0\.1|onrender\.com|pages\.dev/i
    for (const value of strings(workflow)) assert.doesNotMatch(value, host)
  })

  it('saves no executions', () => {
    assert.equal(workflow.settings.saveDataSuccessExecution, 'none')
    assert.equal(workflow.settings.saveDataErrorExecution, 'none')
    assert.equal(workflow.settings.saveManualExecutions, false)
    assert.equal(workflow.settings.executionOrder, 'v1')
  })
})

describe('rules (docs/AUTOMATIZACION.md, "Reglas del flujo")', () => {
  it('validates as documented', () => {
    assert.deepEqual(rules.validation.freeEmailProviders, ['gmail', 'hotmail', 'outlook', 'yahoo', 'icloud'])
    assert.equal(rules.validation.minMessageLength, 40)
    assert.equal(rules.validation.maxLinks, 2)
    assert.deepEqual(rules.validation.blockingChecks, ['no_suspicious_links'])
    const links = (message) => (message.match(new RegExp(rules.validation.linkPattern, 'gi')) ?? []).length
    assert.equal(links('Mira https://a.co, http://b.co y www.c.co'), 3)
    assert.equal(links('Sin enlaces, solo texto.'), 0)
    for (const [id, label] of Object.entries(rules.validation.labels)) {
      assert.match(id, /^[A-Za-z0-9_-]{1,40}$/)
      assert.ok(label.length >= 1 && label.length <= 120)
    }
  })

  it('scores as documented', () => {
    const { scoring } = rules
    assert.deepEqual(scoring.budget, { lt500: 5, '500-2000': 15, '2000-5000': 25, gt5000: 35, unknown: 10 })
    assert.deepEqual(scoring.timeline, { urgent: 20, month: 15, flexible: 5 })
    assert.deepEqual(scoring.service, { automation: 20, app: 20, other: 12 })
    assert.equal(scoring.corporateEmail, 10)
    assert.equal(scoring.detailedMessage, 15)
    assert.equal(scoring.detailedMessageLength, 80)
    assert.equal(scoring.max, 100)
    assert.deepEqual(scoring.tiers, { hot: 70, warm: 40 })
  })

  it('routes as documented', () => {
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(rules.routes).map(([tier, { route, label }]) => [tier, [route, label]]),
      ),
      {
        hot: ['call', 'Llamada en menos de 24 horas'],
        warm: ['proposal', 'Propuesta por correo en 48 horas'],
        cold: ['nurture', 'Secuencia de contenido útil'],
      },
    )
    for (const { sla } of Object.values(rules.routes)) assert.ok(sla.length >= 1 && sla.length <= 120)
  })

  it('has a draft for every route that fits the contract', () => {
    const vars = {
      firstName: 'x'.repeat(80),
      service: 'x'.repeat(80),
      fromCompany: ` desde ${'x'.repeat(80)}`,
    }
    const fill = (text) => text.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match)
    for (const { route } of Object.values(rules.routes)) {
      const draft = rules.drafts[route]
      assert.ok(draft, route)
      assert.ok(fill(draft.subject).length >= 1)
      assert.ok(fill(draft.body.join('\n\n')).length <= 2000, route)
      assert.doesNotMatch(fill(`${draft.subject} ${draft.body.join(' ')}`), /\{\w+\}/, route)
    }
  })
})
