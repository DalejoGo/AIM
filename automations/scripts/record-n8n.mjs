// Runs every lead of test/fixtures/leads.json through a real n8n (this folder's image, in Docker) and saves
// what n8n reported for each step to test/fixtures/n8n-runs.json. test/parity.test.ts then checks that the
// flow the edge runs (src/lead-flow.ts) answers exactly the same. Run it after changing the workflow:
//
//   pnpm --filter @aim/automations record:n8n
//
// n8n reaches the stand-in of the site below through host.docker.internal (README.md, "Correrlo en local").
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { fingerprint } from './fingerprint.mjs'

const here = (path) => fileURLToPath(new URL(path, import.meta.url))
const IMAGE = 'aim-n8n:parity'
const CONTAINER = 'aim-n8n-parity'
const SITE_PORT = Number(process.env.PARITY_SITE_PORT ?? 8790)
const N8N_PORT = Number(process.env.PARITY_N8N_PORT ?? 15679)
const TOKEN = 'parity.callback.token'
const BOOT_TIMEOUT_MS = 300_000
const RUN_TIMEOUT_MS = 30_000

const workflow = JSON.parse(readFileSync(here('../workflows/lead-demo.json'), 'utf8'))
const leads = JSON.parse(readFileSync(here('../test/fixtures/leads.json'), 'utf8'))
const n8nVersion = /n8n:([\w.-]+)@/.exec(readFileSync(here('../Dockerfile'), 'utf8'))?.[1] ?? 'unknown'

function docker(...args) {
  const result = spawnSync('docker', args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed`)
  return result.stdout.trim()
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** runId → the steps n8n reported, in arrival order. */
const reported = new Map()
const site = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    const runId = /^\/api\/automation\/runs\/([0-9a-f-]{36})\/events$/.exec(req.url ?? '')?.[1]
    if (req.method !== 'POST' || !runId || req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end()
      return
    }
    const { step, data } = JSON.parse(body)
    reported.set(runId, [...(reported.get(runId) ?? []), { step, data }])
    res.writeHead(204).end()
  })
})

async function waitFor(check, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await sleep(250)
  }
  throw new Error(`timed out waiting for ${what}`)
}

const n8n = `http://127.0.0.1:${N8N_PORT}`

try {
  await new Promise((resolve) => site.listen(SITE_PORT, '0.0.0.0', resolve))
  console.log(`record-n8n: building ${IMAGE} (n8n ${n8nVersion})`)
  spawnSync('docker', ['build', '-q', '-t', IMAGE, here('..')], { stdio: 'inherit' })
  spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' })
  docker(
    'run',
    '-d',
    '--name',
    CONTAINER,
    '-p',
    `127.0.0.1:${N8N_PORT}:5678`,
    '--add-host=host.docker.internal:host-gateway',
    '-e',
    `AIM_SITE_ORIGIN=http://host.docker.internal:${SITE_PORT}`,
    '-e',
    'N8N_SSRF_PROTECTION_ENABLED=false',
    IMAGE,
  )
  await waitFor(
    async () => (await fetch(`${n8n}/healthz/readiness`).catch(() => null))?.status === 200,
    BOOT_TIMEOUT_MS,
    'n8n to boot',
  )

  const runs = []
  for (const { id, runId, lead } of leads) {
    const response = await fetch(`${n8n}/webhook/aim-lead-demo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId, callbackToken: TOKEN, lead }),
    })
    if (response.status !== 202) throw new Error(`${id}: the webhook answered ${response.status}`)
    await waitFor(
      () => (reported.get(runId) ?? []).some((report) => report.step === 'done'),
      RUN_TIMEOUT_MS,
      `${id} to finish`,
    )
    const steps = reported.get(runId)
    runs.push({ id, steps })
    console.log(`record-n8n: ${id} → ${steps.map((report) => report.step).join(', ')}`)
  }

  const out = here('../test/fixtures/n8n-runs.json')
  const recording = { fingerprint: fingerprint(workflow), n8n: n8nVersion, runs }
  writeFileSync(out, `${JSON.stringify(recording, null, 2)}\n`)
  console.log(`record-n8n: wrote ${runs.length} runs to test/fixtures/n8n-runs.json`)
} finally {
  spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' })
  site.close()
}
