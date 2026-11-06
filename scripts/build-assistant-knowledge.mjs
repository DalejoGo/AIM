#!/usr/bin/env node
// Builds what the Lab assistant knows (apps/edge/src/assistant/knowledge.generated.ts) from the site content in
// apps/web/src/content, so it only says what the site says (CLAUDE.md rule 5: nothing about David is invented).
//
//   node scripts/build-assistant-knowledge.mjs           regenerate the file
//   node scripts/build-assistant-knowledge.mjs --check   exit 1 if the file is out of date with the content
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT = join(ROOT, 'apps/web/src/content')
const OUTPUT = join(ROOT, 'apps/edge/src/assistant/knowledge.generated.ts')

// --- Reading the content -------------------------------------------------------------------------------------

function readJson(path) {
  return JSON.parse(readFileSync(join(CONTENT, path), 'utf8'))
}

/** Files of a folder in name order, so the output never depends on the file system. */
function filesIn(folder, extension) {
  return readdirSync(join(CONTENT, folder))
    .filter((name) => name.endsWith(extension))
    .sort()
    .map((name) => join(folder, name))
}

/**
 * The frontmatter subset the content uses: `key: scalar`, `key: [a, b]`, `key: {}` and block lists (`  - item`).
 * Anything else fails loudly instead of being misread.
 */
function readMarkdown(path) {
  const source = readFileSync(join(CONTENT, path), 'utf8').replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(source)
  if (!match) throw new Error(`${path}: missing frontmatter`)
  const data = {}
  let list = null
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item) {
      if (!list) throw new Error(`${path}: list item outside a list: ${line}`)
      list.push(scalar(item[1], path))
      continue
    }
    const pair = /^([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(line)
    if (!pair) throw new Error(`${path}: unsupported frontmatter line: ${line}`)
    const [, key, raw] = pair
    list = null
    if (raw === undefined || raw.trim() === '') {
      list = []
      data[key] = list
    } else {
      data[key] = flowValue(raw.trim(), path)
    }
  }
  return { data, body: match[2].trim() }
}

function flowValue(raw, path) {
  if (raw === '{}') return {}
  if (raw.startsWith('{')) throw new Error(`${path}: unsupported inline mapping: ${raw}`)
  if (raw.startsWith('[')) {
    if (!raw.endsWith(']')) throw new Error(`${path}: unclosed list: ${raw}`)
    const inner = raw.slice(1, -1).trim()
    return inner ? inner.split(',').map((part) => scalar(part.trim(), path)) : []
  }
  return scalar(raw, path)
}

function scalar(raw, path) {
  if (/^".*"$/.test(raw)) return JSON.parse(raw)
  if (/^'.*'$/.test(raw)) return raw.slice(1, -1).replace(/''/g, "'")
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null' || raw === '~') return null
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  if (/^[[{&*!|>%@`]/.test(raw)) throw new Error(`${path}: unsupported value: ${raw}`)
  return raw
}

// --- Formatting ----------------------------------------------------------------------------------------------

/** es-CO grouping (900.000), written by hand so the output does not depend on the ICU data of the Node build. */
function thousands(amount) {
  if (!Number.isInteger(amount) || amount < 0) throw new Error(`Unexpected amount: ${amount}`)
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function price(amounts) {
  return `COP ${thousands(amounts.COP)} / USD ${thousands(amounts.USD)}`
}

function percent(multiplier) {
  const value = Math.round((multiplier - 1) * 100)
  return value === 0 ? 'sin recargo' : `+${value} %`
}

const sentence = (text) => (/[.!?…]$/.test(text) ? text : `${text}.`)
const joinList = (items) => items.join('; ')

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

function longDate(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return `${day} de ${MONTHS[month - 1]} de ${year}`
}

// --- Sections ------------------------------------------------------------------------------------------------

function brandSection(site) {
  const { brand, founder, contact, media } = site
  const lines = [
    `# ${brand.fullName}`,
    `Lema: ${sentence(brand.tagline)}`,
    sentence(brand.description),
    `Fundador: ${founder.name} (${founder.shortName}), ${founder.role.charAt(0).toLowerCase()}${founder.role.slice(1)}.`,
    '',
    '## Contacto',
    `- WhatsApp: +${contact.whatsapp} (https://wa.me/${contact.whatsapp})`,
  ]
  if (contact.email) lines.push(`- Correo: ${contact.email}`)
  lines.push('- Formulario de contacto: /contacto/', '- Cotizador: /cotizar/')
  if (contact.linkedin) lines.push(`- LinkedIn: ${contact.linkedin}`)
  if (contact.github) lines.push(`- GitHub: ${contact.github}`)
  if (contact.platzi) lines.push(`- Platzi: ${contact.platzi}`)
  lines.push(`- Hoja de vida en PDF: ${media.cv}`, '- Sobre David: /sobre-mi/')
  return lines
}

function servicesSection(services, quote) {
  const lines = [
    '',
    '## Servicios',
    'Precios "desde" (precio de arranque) en pesos colombianos (COP) y dólares (USD).',
  ]
  for (const service of services) {
    const extras = quote.services.find((entry) => entry.service === service.id)?.options ?? []
    lines.push(
      '',
      `### ${service.title} (/servicios/${service.slug}/)`,
      `${sentence(service.tagline)} ${sentence(service.summary)}`,
      `- Incluye: ${joinList(service.includes)}.`,
      `- Entregables: ${joinList(service.deliverables)}.`,
      `- Tecnologías: ${service.technologies.join(', ')}.`,
      `- Ideal para: ${sentence(service.idealFor)}`,
      `- Tiempo de referencia: ${service.timeline}.`,
      service.priceFrom
        ? `- Precio desde: ${price(service.priceFrom)}.`
        : '- Precio: sin precio publicado; se cotiza sin costo.',
      `- Cotizar este servicio: /cotizar/?servicio=${service.id}`,
    )
    if (extras.length > 0) {
      lines.push('- Adicionales en el cotizador:')
      for (const option of extras) {
        lines.push(`  - ${option.label}: ${price(option.price)}. ${sentence(option.description)}`)
      }
    }
  }
  return lines
}

function quoteSection(quote) {
  const timelines = quote.timelines.map((t) => `${t.label} (${percent(t.multiplier)})`).join(', ')
  return [
    '',
    '## Cotizador (/cotizar/)',
    'Suma el precio base del servicio y los adicionales elegidos, aplica el plazo y muestra un rango en COP o USD.',
    `- Plazos: ${timelines}.`,
    `- El tope del rango es ${Math.round(quote.spread * 100)} % mayor que el mínimo.`,
    '- Al final arma un resumen listo para enviar por WhatsApp o por el formulario.',
  ]
}

function faqSection(faq) {
  const lines = ['', '## Preguntas frecuentes']
  for (const { q, a } of faq) lines.push(`- ${q} ${a}`)
  return lines
}

function projectsSection(projects) {
  const lines = ['', '## Proyectos publicados']
  for (const { data, body } of projects) {
    lines.push(
      '',
      `### ${data.title} (/proyectos/${data.slug}/)`,
      `${sentence(data.summary)} Año: ${data.year}. Rol de David: ${data.role}.`,
      `- Tecnologías: ${data.stack.join(', ')}.`,
      `- Reto: ${sentence(data.challenge)}`,
      `- Solución: ${sentence(data.solution)}`,
    )
    if (data.results?.length) lines.push(`- Resultados: ${joinList(data.results)}.`)
    if (data.highlights?.length) lines.push(`- Destacados: ${joinList(data.highlights)}.`)
    if (body) lines.push(`- Nota: ${body.replace(/\s+/g, ' ')}`)
  }
  return lines
}

function labSection(demos, certificateTitles) {
  const lines = ['', '## Lab (/lab/): demos interactivas, cada una respaldada por certificaciones']
  for (const { data, body } of demos) {
    const url = data.status === 'live' ? data.href : `/lab/${data.slug}/`
    const state = data.status === 'live' ? 'disponible' : 'próximamente'
    lines.push('', `### ${data.title} (${url}, ${state})`, sentence(data.summary))
    if (body) lines.push(body.replace(/\s+/g, ' '))
    lines.push(`- Tecnologías: ${data.stack.join(', ')}.`)
    const certificates = (data.certificates ?? []).map((id) => {
      const title = certificateTitles.get(id)
      if (!title) throw new Error(`lab/${data.slug}: unknown certificate ${id}`)
      return title
    })
    if (certificates.length > 0) lines.push(`- Certificaciones relacionadas: ${joinList(certificates)}.`)
  }
  return lines
}

function certificatesSection(certificates) {
  const lines = ['', '## Certificaciones']
  for (const c of certificates) {
    lines.push(
      `- ${c.title} (${c.issuer}, ${longDate(c.issuedOn)}, ${c.hours} horas; demo: /lab/${c.demo}/).`,
    )
  }
  return lines
}

function profileSection(profile) {
  const lines = [
    '',
    '## Perfil de David',
    '(Los textos en primera persona de esta sección son de David.)',
    sentence(profile.summary),
    '',
    'Experiencia:',
  ]
  for (const job of profile.experience) {
    lines.push(
      `- ${job.role} en ${job.company}${job.current ? ' (actual)' : ''}: ${sentence(job.description)}`,
    )
  }
  lines.push('', 'Formación:')
  for (const study of profile.education) {
    const details = [study.institution, study.period].filter(Boolean).join(', ')
    lines.push(`- ${study.title}${details ? ` (${details})` : ''}.`)
  }
  lines.push('', 'Habilidades:')
  for (const skill of profile.skills) lines.push(`- ${skill.group}: ${skill.items.join(', ')}.`)
  return lines
}

function buildKnowledge() {
  const site = readJson('site.json')
  const quote = readJson('quote.json')
  const services = filesIn('services', '.json')
    .map(readJson)
    .sort((a, b) => a.order - b.order)
  const projects = filesIn('projects', '.md')
    .map(readMarkdown)
    // Only projects David confirmed can be shown (DEC-008).
    .filter((p) => p.data.public === true)
    .sort((a, b) => (a.data.order ?? 100) - (b.data.order ?? 100))
  const demos = filesIn('lab', '.md')
    .map(readMarkdown)
    .sort((a, b) => a.data.order - b.data.order)
  const certificates = readJson('certificates.json')
  const certificateTitles = new Map(certificates.map((c) => [c.id, c.title]))

  return [
    ...brandSection(site),
    ...servicesSection(services, quote),
    ...quoteSection(quote),
    ...faqSection(readJson('faq.json')),
    ...projectsSection(projects),
    ...labSection(demos, certificateTitles),
    ...certificatesSection(certificates),
    ...profileSection(readJson('profile.json')),
  ]
}

// --- Output --------------------------------------------------------------------------------------------------

/** A string literal the way Biome formats it: single quotes unless that needs more escapes than double quotes. */
function literal(text) {
  if (/[\p{Cc}\u2028\u2029]/u.test(text)) throw new Error(`Unexpected control character in: ${text}`)
  const singles = (text.match(/'/g) ?? []).length
  const doubles = (text.match(/"/g) ?? []).length
  const quote = singles > doubles ? '"' : "'"
  return `${quote}${text.replace(/\\/g, '\\\\').replaceAll(quote, `\\${quote}`)}${quote}`
}

function renderModule(lines) {
  return [
    '// Generated by scripts/build-assistant-knowledge.mjs from apps/web/src/content. Do not edit by hand:',
    '// change the content and run `node scripts/build-assistant-knowledge.mjs`.',
    '',
    '/** Everything the Lab assistant knows about AIM and David, in Spanish. */',
    'export const ASSISTANT_KNOWLEDGE = [',
    ...lines.map((line) => `  ${literal(line)},`),
    "].join('\\n')",
    '',
  ].join('\n')
}

function main() {
  const expected = renderModule(buildKnowledge())
  const target = relative(ROOT, OUTPUT)
  if (process.argv.includes('--check')) {
    let current = null
    try {
      current = readFileSync(OUTPUT, 'utf8')
    } catch {
      // Missing file: reported below.
    }
    if (current !== expected) {
      console.error(`${target} is out of date. Run: node scripts/build-assistant-knowledge.mjs`)
      process.exit(1)
    }
    console.log(`${target} is up to date.`)
    return
  }
  writeFileSync(OUTPUT, expected)
  console.log(`Wrote ${target}.`)
}

main()
