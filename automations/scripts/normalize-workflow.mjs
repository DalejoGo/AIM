// Keeps only what defines the flow from an `n8n export:workflow` file, so the versioned JSON does not
// change with every save: no instance id, timestamps, sharing, version ids or pinned test data.
// Usage: node automations/scripts/normalize-workflow.mjs <exported.json> <automations/workflows/lead-demo.json>
import { readFileSync, writeFileSync } from 'node:fs'

const [source, target] = process.argv.slice(2)
if (!source || !target) {
  process.stderr.write('Usage: node normalize-workflow.mjs <exported.json> <target.json>\n')
  process.exit(1)
}

const current = JSON.parse(readFileSync(target, 'utf8'))
const exported = JSON.parse(readFileSync(source, 'utf8'))
const workflow = (Array.isArray(exported) ? exported : [exported]).find((item) => item.id === current.id)
if (!workflow) {
  process.stderr.write(`The export has no workflow with id ${current.id}\n`)
  process.exit(1)
}

const kept = {
  id: workflow.id,
  name: workflow.name,
  ...(workflow.description ? { description: workflow.description } : {}),
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: workflow.settings,
}
writeFileSync(target, `${JSON.stringify(kept, null, 2)}\n`)
