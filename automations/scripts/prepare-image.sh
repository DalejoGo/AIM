#!/bin/sh
# Runs once, inside `docker build` (full CPU), so that a boot on Render Free (0.1 CPU) only runs
# `n8n start`: the database is migrated, the workflow imported and published, and Node's compile
# cache filled. Nothing secret stays in the image: the instance key is deleted at the end and every
# boot creates a new random one (no credentials are ever stored, so nothing needs it twice).
set -eu

workflow=/opt/aim/workflows/lead-demo.json
state=/home/node/.aim

# 1. What the workflow needs, read from the JSON itself, so editing the flow in n8n never needs a
#    change here: its id, the node types to load (nothing else is loaded in webhook mode) and the
#    task runner mode (only a Code node needs a runner; without one none is started).
mkdir -p "$state"
node - "$workflow" "$state/runtime.env" <<'JS'
const { readFileSync, writeFileSync } = require('node:fs')
const [file, out] = process.argv.slice(2)
const workflow = JSON.parse(readFileSync(file, 'utf8'))
const types = [...new Set(workflow.nodes.map((node) => node.type))].sort()
const safe = /^[\w@./-]+$/
if (!safe.test(workflow.id) || !types.every((type) => safe.test(type))) throw new Error('Unexpected id or node type')
const needsRunner = types.some((type) => /\.(code|function|functionItem|pythonCode|aiTransform)$/.test(type))
writeFileSync(
  out,
  [
    `AIM_WORKFLOW_ID='${workflow.id}'`,
    `NODES_INCLUDE='${JSON.stringify(types)}'`,
    `AIM_RUNNERS_MODE='${needsRunner ? 'internal' : 'external'}'`,
    '',
  ].join('\n'),
)
JS
. "$state/runtime.env"
export NODES_INCLUDE
echo "prepare-image: workflow $AIM_WORKFLOW_ID, nodes $NODES_INCLUDE, runner $AIM_RUNNERS_MODE"

# 2. Migrate the database, import the workflow and publish it (the active version that `n8n start` loads).
n8n import:workflow --input="$workflow"
n8n publish:workflow --id="$AIM_WORKFLOW_ID"

# 3. Smoke test and warm-up: boot exactly like production (same entrypoint, same flags) against a
#    throwaway copy of the database and run the whole flow once against a local stand-in of the site
#    that accepts every step. The build fails unless the seven steps arrive in order. Stopping n8n
#    makes Node write its compile cache.
mkdir -p /tmp/warm/.n8n
cp /home/node/.n8n/database.sqlite* /tmp/warm/.n8n/
node -e "
  const { appendFileSync } = require('node:fs')
  require('node:http').createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk }).on('end', () => {
      appendFileSync('/tmp/warm/steps', JSON.parse(body).step + ' ')
      res.writeHead(204).end()
    })
  }).listen(8790, '127.0.0.1')" &
site=$!
N8N_USER_FOLDER=/tmp/warm AIM_SITE_ORIGIN=http://127.0.0.1:8790 N8N_SSRF_PROTECTION_ENABLED=false \
  sh /opt/aim/scripts/entrypoint.sh &
n8n=$!
lead='{"name":"Laura Pérez","company":"Café La Montaña","email":"laura@cafelamontana.co","service":"automation","serviceTitle":"Automatizaciones","budget":"500-2000","timeline":"month","message":"Queremos que los pedidos de WhatsApp lleguen solos a una hoja y avisen al equipo."}'
tries=0
until wget -S -q -O /dev/null --header='Content-Type: application/json' \
  --post-data="{\"runId\":\"0b7c6a2e-0000-4000-8000-000000000000\",\"callbackToken\":\"a.b.c\",\"lead\":$lead}" \
  http://127.0.0.1:5678/webhook/aim-lead-demo 2>&1 | grep -q ' 202 '; do
  tries=$((tries + 1))
  if [ "$tries" -gt 180 ]; then
    echo 'prepare-image: the webhook never answered 202' >&2
    kill "$n8n" "$site"
    exit 1
  fi
  sleep 1
done
expected='received validated scored routed drafted recorded done '
tries=0
until [ "$(cat /tmp/warm/steps 2>/dev/null)" = "$expected" ]; do
  tries=$((tries + 1))
  if [ "$tries" -gt 60 ]; then
    echo "prepare-image: the flow reported '$(cat /tmp/warm/steps 2>/dev/null)', expected '$expected'" >&2
    kill "$n8n" "$site"
    exit 1
  fi
  sleep 1
done
echo "prepare-image: smoke test passed ($expected)"
kill -TERM "$n8n"
wait "$n8n" || true
kill "$site"

# 4. Keep what the warm-up wrote when it published the workflow (the webhook registration and the
#    published version), so the webhook answers as soon as /healthz/readiness does. Without it n8n
#    publishes again on every boot and the webhook answers 404 for ~10 s more. Nothing else is copied:
#    the instance stays unclaimed and holds no key.
node - <<'JS'
const sqlite3 = require(require.resolve('sqlite3', { paths: ['/usr/local/lib/node_modules/n8n'] }))
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite')
const tables = [
  'webhook_entity',
  'workflow_published_version',
  'workflow_publication_trigger_status',
  'workflow_publication_outbox',
]
const copy = tables.map((t) => `INSERT INTO main.${t} SELECT * FROM warm.${t};`).join(' ')
db.exec(`ATTACH '/tmp/warm/.n8n/database.sqlite' AS warm; ${copy} DETACH warm;`, (error) => {
  if (error) throw error
  db.get('SELECT count(*) AS n FROM webhook_entity', (err, row) => {
    if (err || row.n < 1) throw err ?? new Error('No webhook registered')
    db.close()
  })
})
JS

# 5. Leave no state but the database: no instance key, logs or caches from the build.
rm -rf /tmp/warm /home/node/.n8n/config /home/node/.n8n/n8nEventLog*.log /home/node/.n8n/crash.journal
ls -la /home/node/.n8n
du -sh "$NODE_COMPILE_CACHE"
