/**
 * The assistant's answers as data the island renders with plain elements (never innerHTML): paragraphs,
 * simple lists and bold text. Links are kept only for pages of this site ("/cotizar/") and WhatsApp
 * ("https://wa.me/…"); any other address stays as text.
 */

export type Inline =
  | { type: 'text'; text: string; strong: boolean }
  | { type: 'link'; text: string; href: string; strong: boolean }

export type Block =
  | { type: 'paragraph'; lines: Inline[][] }
  | { type: 'list'; ordered: boolean; start: number; items: Inline[][] }

const WHATSAPP_PREFIX = 'https://wa.me/'
// A path of this site: one slash, then no second slash or backslash (both would point to another host),
// and only URL characters (no spaces, quotes, angle brackets or control characters).
const INTERNAL_PATH = /^\/(?![/\\])[\w\-.~!$&'()*+,;=:@%/?#]*$/
const PROBE_ORIGIN = 'https://aim.invalid'

/** The href to use for a link in an answer, or null when it must stay as text. */
export function safeHref(raw: string): string | null {
  const href = raw.trim()
  if (INTERNAL_PATH.test(href)) {
    try {
      return new URL(href, PROBE_ORIGIN).origin === PROBE_ORIGIN ? href : null
    } catch {
      return null
    }
  }
  if (!href.startsWith(WHATSAPP_PREFIX)) return null
  try {
    const url = new URL(href)
    const plain = url.protocol === 'https:' && !url.username && !url.password && !url.port
    return plain && url.hostname === 'wa.me' ? url.href : null
  } catch {
    return null
  }
}

// One pass over a line: bold markers, Markdown links, bare addresses and bare site paths. A bare path must
// follow a space or an opening sign, so "24/7" or "y/o" stay as text.
const INLINE = new RegExp(
  [
    String.raw`(?<bold>\*\*)`,
    String.raw`\[(?<label>[^\]\n]+)\]\((?<href>[^()\s]*)\)`,
    String.raw`(?<url>https?:\/\/[^\s<>()[\]"'*«»“”‘’]+)`,
    String.raw`(?<path>(?<![\w/.:@\-])\/[A-Za-z0-9][\w\-.~/?=&%#+]*)`,
  ].join('|'),
  'g',
)
const TRAILING_PUNCTUATION = /[.,;:!?]+$/

type Token =
  | { kind: 'marker' }
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string }

/** A bare address or path: the closing punctuation of the sentence is not part of it. */
function bare(match: string, accept: (candidate: string) => boolean): Token[] {
  const tail = match.match(TRAILING_PUNCTUATION)?.[0] ?? ''
  const candidate = match.slice(0, match.length - tail.length)
  const href = accept(candidate) ? safeHref(candidate) : null
  const tokens: Token[] = [href ? { kind: 'link', text: candidate, href } : { kind: 'text', text: candidate }]
  if (tail) tokens.push({ kind: 'text', text: tail })
  return tokens
}

// Site paths end in "/" or name a file, so a lone "/mes" in "USD 250 /mes" is not taken for a page.
const looksLikePage = (path: string) => path.indexOf('/', 1) !== -1

function classify(match: RegExpMatchArray): Token[] {
  const groups = match.groups ?? {}
  if (groups.bold) return [{ kind: 'marker' }]
  if (groups.label !== undefined) {
    const label = groups.label.replaceAll('**', '').trim()
    const target = groups.href ?? ''
    const href = safeHref(target)
    if (href) return [{ kind: 'link', text: label || target, href }]
    // Not a link we allow: the visitor still sees where it pointed, as text.
    return [{ kind: 'text', text: !target || target === label ? label : `${label} (${target})` }]
  }
  if (groups.url) return bare(groups.url, () => true)
  if (groups.path) return bare(groups.path, looksLikePage)
  return [{ kind: 'text', text: match[0] }]
}

/** One line of text as inline pieces. An unpaired "**" is shown as typed. */
export function parseInline(line: string): Inline[] {
  // Inline code marks (`/cotizar/`) are dropped: the answers are plain text, not code.
  const source = line.replace(/`([^`\n]+)`/g, '$1')
  const tokens: Token[] = []
  let last = 0
  for (const match of source.matchAll(INLINE)) {
    const index = match.index ?? 0
    if (index > last) tokens.push({ kind: 'text', text: source.slice(last, index) })
    tokens.push(...classify(match))
    last = index + match[0].length
  }
  if (last < source.length) tokens.push({ kind: 'text', text: source.slice(last) })

  const markers = tokens.filter((t) => t.kind === 'marker').length
  const paired = markers - (markers % 2)
  const out: Inline[] = []
  let strong = false
  let seen = 0
  const pushText = (text: string) => {
    const previous = out.at(-1)
    if (previous?.type === 'text' && previous.strong === strong) previous.text += text
    else if (text) out.push({ type: 'text', text, strong })
  }
  for (const token of tokens) {
    if (token.kind === 'marker') {
      seen += 1
      if (seen > paired) pushText('**')
      else strong = !strong
    } else if (token.kind === 'text') {
      pushText(token.text)
    } else {
      out.push({ type: 'link', text: token.text, href: token.href, strong })
    }
  }
  return out.filter((piece) => piece.type === 'link' || piece.text !== '')
}

const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*(\d{1,4})[.)]\s+(.*)$/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)[\s#]*$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const FENCE = /^\s*```/
const INDENTED = /^\s{2,}\S/

interface OpenList {
  ordered: boolean
  start: number
  items: string[]
}

/**
 * Splits an answer into blocks. Lines inside a paragraph keep their breaks; "-", "*" or "1." start list
 * items (a blank line between items keeps the list together); a heading becomes a bold line, since the
 * answers have no headings of their own.
 */
export function parseRichText(text: string): Block[] {
  const blocks: Block[] = []
  let paragraph: Inline[][] = []
  let list: OpenList | null = null
  let blankAfterList = false

  const closeParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', lines: paragraph })
    paragraph = []
  }
  const closeList = () => {
    const items = list?.items.map((item) => parseInline(item.trim())).filter((item) => item.length > 0) ?? []
    if (list && items.length > 0)
      blocks.push({ type: 'list', ordered: list.ordered, start: list.start, items })
    list = null
    blankAfterList = false
  }

  for (const raw of text.split(/\r\n|\r|\n/)) {
    if (FENCE.test(raw)) continue
    if (raw.trim() === '' || RULE.test(raw)) {
      closeParagraph()
      if (list) blankAfterList = true
      continue
    }
    const bullet = raw.match(BULLET)
    const numbered = bullet ? null : raw.match(NUMBERED)
    if (bullet || numbered) {
      const ordered = numbered !== null
      const content = (bullet ? bullet[1] : numbered?.[2]) ?? ''
      closeParagraph()
      if (list && list.ordered !== ordered) closeList()
      if (!list) list = { ordered, start: ordered ? Number(numbered?.[1] ?? 1) : 1, items: [] }
      list.items.push(content)
      blankAfterList = false
      continue
    }
    if (list && !blankAfterList && INDENTED.test(raw) && list.items.length > 0) {
      list.items[list.items.length - 1] += ` ${raw.trim()}`
      continue
    }
    closeList()
    const heading = raw.match(HEADING)
    if (heading) {
      closeParagraph()
      const line = parseInline(heading[1] ?? '').map((piece) => ({ ...piece, strong: true }))
      if (line.length > 0) blocks.push({ type: 'paragraph', lines: [line] })
      continue
    }
    const line = parseInline(raw.trim())
    if (line.length > 0) paragraph.push(line)
  }
  closeParagraph()
  closeList()
  return blocks
}
