// What makes the flow behave: every node but the sticky notes (name, type, version, parameters) and the
// connections. Moving a node or editing a note in n8n does not change it. test/fixtures/n8n-runs.json keeps
// the fingerprint it was recorded with, so a changed flow needs a new recording (scripts/record-n8n.mjs).
import { createHash } from 'node:crypto'

const sorted = (value) =>
  Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sorted(value[key])]),
        )
      : value

export function fingerprint(workflow) {
  const nodes = workflow.nodes
    .filter((node) => node.type !== 'n8n-nodes-base.stickyNote')
    .map(({ name, type, typeVersion, parameters }) => ({ name, type, typeVersion, parameters }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
  const json = JSON.stringify(sorted({ nodes, connections: workflow.connections }))
  return createHash('sha256').update(json).digest('hex').slice(0, 16)
}
