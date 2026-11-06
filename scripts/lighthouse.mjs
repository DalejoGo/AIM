// Lighthouse audit of the key pages on mobile and desktop. Prints a table and writes it to docs/RENDIMIENTO.md,
// between the audit markers (the rest of that file is written by hand).
//
// Usage: pnpm run audit <base-url> [--pages /,/lab/] [--devices mobile,desktop] [--runs 3] [--strict]
//   (`pnpm audit` alone is pnpm's dependency audit: use `pnpm run audit`.)
// The base URL comes from the argument or PUBLIC_BASE_URL (no host is hard-coded, DEC-007).
// Chrome: CHROME_PATH (read by Lighthouse itself), or else the newest Chromium downloaded by Playwright.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LIGHTHOUSE_CLI = join(ROOT, 'node_modules/lighthouse/cli/index.js')
const TARGET = 95
const START = '<!-- audit:start -->'
const END = '<!-- audit:end -->'

/** The pages of docs/PLAN.md §5's Lighthouse goal: one per kind of page. */
const DEFAULT_PAGES = [
  '/',
  '/servicios/',
  '/proyectos/marea/',
  '/cotizar/',
  '/lab/',
  '/lab/migrador-de-datos/',
  '/sobre-mi/',
  '/contacto/',
]
const CATEGORIES = [
  ['performance', 'Rendimiento'],
  ['accessibility', 'Accesibilidad'],
  ['best-practices', 'Buenas prácticas'],
  ['seo', 'SEO'],
]
const DEVICE_LABEL = { mobile: 'Móvil', desktop: 'Escritorio' }

const { values, positionals } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  allowPositionals: true,
  options: {
    pages: { type: 'string' },
    devices: { type: 'string', default: 'mobile,desktop' },
    runs: { type: 'string', default: '1' },
    out: { type: 'string', default: 'docs/RENDIMIENTO.md' },
    reports: { type: 'string' },
    strict: { type: 'boolean', default: false },
  },
})

const baseUrl = positionals[0] ?? process.env.PUBLIC_BASE_URL
if (!baseUrl) {
  console.error('Falta la URL base: pnpm run audit http://localhost:4321 (o PUBLIC_BASE_URL).')
  process.exit(2)
}
const pages = values.pages ? values.pages.split(',').map((p) => p.trim()) : DEFAULT_PAGES
const devices = values.devices.split(',').map((d) => d.trim())
for (const device of devices) {
  if (!(device in DEVICE_LABEL)) throw new Error(`Dispositivo desconocido: ${device} (mobile o desktop).`)
}
const runs = Math.max(1, Number.parseInt(values.runs, 10) || 1)
const reportsDir = values.reports ? resolve(values.reports) : mkdtempSync(join(tmpdir(), 'aim-lighthouse-'))
mkdirSync(reportsDir, { recursive: true })

/** The newest Chromium that Playwright downloaded (the E2E browser), for when CHROME_PATH is not set. */
function playwrightChromium() {
  const cache = join(homedir(), '.cache/ms-playwright')
  if (!existsSync(cache)) return undefined
  const builds = readdirSync(cache)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const build of builds) {
    const binary = join(cache, build, 'chrome-linux64/chrome')
    if (existsSync(binary)) return binary
  }
  return undefined
}

function lighthouse(url, device, outputPath, fallbackChrome) {
  const args = [
    LIGHTHOUSE_CLI,
    url,
    '--quiet',
    '--output=json',
    `--output-path=${outputPath}`,
    `--only-categories=${CATEGORIES.map(([id]) => id).join(',')}`,
    // Headless; --no-sandbox because WSL and CI containers have no user namespaces (only our own site is opened).
    '--chrome-flags=--headless=new --no-sandbox',
    ...(device === 'desktop' ? ['--preset=desktop'] : []),
  ]
  // An explicit CHROME_PATH in the environment wins over the fallback.
  const env = fallbackChrome ? { CHROME_PATH: fallbackChrome, ...process.env } : process.env
  return new Promise((resolve, reject) => {
    // Under WSL, chrome-launcher builds its profile folder from a Windows path ("C:\\Users\\…\\lighthouse.XXXX")
    // that Linux takes as a relative folder name: run it inside a temp folder so nothing lands in the repo.
    const child = spawn(process.execPath, args, {
      cwd: reportsDir,
      env,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Lighthouse terminó con código ${code} en ${url}`)),
    )
  })
}

const score = (lhr, id) => Math.round((lhr.categories[id]?.score ?? 0) * 100)
const metric = (lhr, id) => lhr.audits[id]?.numericValue ?? 0
const seconds = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`

/** Audits that cost points: failed or partial, with a weight in a category below the target. */
function problems(lhr) {
  const out = []
  for (const [id] of CATEGORIES) {
    if (score(lhr, id) >= TARGET) continue
    for (const ref of lhr.categories[id].auditRefs) {
      const audit = lhr.audits[ref.id]
      if (!audit || audit.score === null || audit.score >= 0.9) continue
      if (audit.scoreDisplayMode === 'informative' || audit.scoreDisplayMode === 'notApplicable') continue
      if (ref.weight === 0 && id !== 'performance') continue
      out.push(`${id}: ${audit.title}${audit.displayValue ? ` (${audit.displayValue})` : ''}`)
    }
  }
  return out
}

const fallbackChrome = playwrightChromium()
const results = []
let version = ''
for (const path of pages) {
  const url = new URL(path, baseUrl).href
  for (const device of devices) {
    const reports = []
    for (let run = 1; run <= runs; run += 1) {
      const name = `${path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'inicio'}-${device}-${run}.json`
      const file = join(reportsDir, name)
      process.stdout.write(`${device.padEnd(8)} ${path} (${run}/${runs})\n`)
      await lighthouse(url, device, file, fallbackChrome)
      reports.push(JSON.parse(readFileSync(file, 'utf8')))
    }
    // The median run by performance score: one slow run should not decide the page's result.
    reports.sort((a, b) => score(a, 'performance') - score(b, 'performance'))
    const lhr = reports[Math.floor(reports.length / 2)]
    version = lhr.lighthouseVersion
    results.push({ path, device, lhr })
  }
}

const now = new Date().toLocaleString('sv-SE').slice(0, 16)
const cell = (value) => (value < TARGET ? `**${value}**` : String(value))
const rows = results.map(({ path, device, lhr }) =>
  [
    `\`${path}\``,
    DEVICE_LABEL[device],
    ...CATEGORIES.map(([id]) => cell(score(lhr, id))),
    seconds(metric(lhr, 'first-contentful-paint')),
    seconds(metric(lhr, 'largest-contentful-paint')),
    `${Math.round(metric(lhr, 'total-blocking-time'))} ms`,
    metric(lhr, 'cumulative-layout-shift').toFixed(3).replace('.', ','),
  ].join(' | '),
)
const below = results.flatMap(({ path, device, lhr }) =>
  problems(lhr).map((p) => `- \`${path}\` (${DEVICE_LABEL[device]}) ${p}`),
)

const block = [
  START,
  `_Generado por \`scripts/lighthouse.mjs\` el ${now} contra \`${baseUrl}\`. Lighthouse ${version}, ` +
    `${runs} corrida(s) por página y dispositivo (se toma la mediana por rendimiento). ` +
    `En negrita, lo que queda por debajo de ${TARGET}._`,
  '',
  `| Página | Dispositivo | ${CATEGORIES.map(([, label]) => label).join(' | ')} | FCP | LCP | TBT | CLS |`,
  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...rows.map((row) => `| ${row} |`),
  '',
  below.length === 0
    ? `Todas las categorías están en ${TARGET} o más.`
    : ['Auditorías que restan puntos:', '', ...below].join('\n'),
  END,
].join('\n')

const outFile = resolve(ROOT, values.out)
const current = existsSync(outFile) ? readFileSync(outFile, 'utf8') : ''
// Only markers alone on their line count (the file may also mention them in its text).
const section = new RegExp(`^${START}$[\\s\\S]*?^${END}$`, 'm')
const next = section.test(current)
  ? current.replace(section, () => block)
  : `${current || '# RENDIMIENTO.md — Auditoría Lighthouse\n\n## Último resultado\n'}\n${block}\n`
writeFileSync(outFile, next)

console.log(`\n${rows.map((row) => row.replaceAll('**', '')).join('\n')}`)
if (below.length > 0) console.log(`\n${below.join('\n')}`)
console.log(`\nResumen en ${relative(ROOT, outFile)}; reportes JSON en ${reportsDir}`)
if (values.strict && below.length > 0) process.exit(1)
