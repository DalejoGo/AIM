// "Cabeceras que protegen este sitio": which security headers the site's real answer carries, what each one
// stops and where it sits in the OWASP Top 10 (2021, the edition the site's comments and certificate use).

export interface OwaspRisk {
  code: string
  name: string
}

const A02: OwaspRisk = { code: 'A02:2021', name: 'fallas criptográficas' }
const A03: OwaspRisk = { code: 'A03:2021', name: 'inyección' }
const A05: OwaspRisk = { code: 'A05:2021', name: 'configuración de seguridad incorrecta' }

export interface SecurityHeader {
  name: string
  /** The attack it stops, in one plain sentence. */
  stops: string
  owasp: OwaspRisk
  /** Listed only when it arrives. */
  optional?: boolean
}

export const CSP = 'Content-Security-Policy'

export const SECURITY_HEADERS: readonly SecurityHeader[] = [
  {
    name: 'Strict-Transport-Security',
    stops:
      'Obliga a tu navegador a entrar siempre por HTTPS, así nadie en una red wifi pública puede pasarte a una conexión sin cifrar para leer o cambiar lo que envías.',
    owasp: A02,
  },
  {
    name: 'X-Content-Type-Options',
    stops:
      'Impide que el navegador adivine el tipo de un archivo, para que algo que llega como texto o imagen nunca se ejecute como código.',
    owasp: A05,
  },
  {
    name: 'X-Frame-Options',
    stops:
      'Impide que otra página muestre este sitio dentro de un marco invisible para engañarte y hacerte dar clic donde no querías (clickjacking).',
    owasp: A05,
  },
  {
    name: 'Referrer-Policy',
    stops:
      'Cuando vas a otro sitio desde aquí, solo le cuenta de qué dominio vienes, no la dirección completa, que podría llevar datos privados.',
    owasp: A05,
  },
  {
    name: 'Permissions-Policy',
    stops:
      'Apaga funciones del navegador que el sitio no usa, como la cámara o el micrófono: ni un script ajeno que se colara podría pedirlas.',
    owasp: A05,
  },
  {
    name: 'Cross-Origin-Opener-Policy',
    stops:
      'Separa esta pestaña de las ventanas de otros sitios que la abren o que ella abre, para que no puedan controlarla ni espiar lo que pasa en ella.',
    owasp: A05,
  },
  {
    name: CSP,
    stops:
      'Le dice al navegador de dónde puede cargar y ejecutar código: si alguien lograra meter un script en la página, no se ejecutaría (XSS).',
    owasp: A03,
    optional: true,
  },
]

/** Where the value came from: the HTTP answer, or a <meta http-equiv> in this page's HTML (only the CSP). */
export type HeaderSource = 'header' | 'meta'

export interface HeaderCheck extends SecurityHeader {
  value: string | null
  source: HeaderSource | null
}

/**
 * Every expected header with its real value, or null when it did not arrive. The CSP is listed only when it
 * arrives, as a header or as a <meta> of the page (`metaCsp`).
 */
export function checkHeaders(headers: Headers, metaCsp: string | null = null): HeaderCheck[] {
  return SECURITY_HEADERS.flatMap((header): HeaderCheck[] => {
    const value = headers.get(header.name)?.trim()
    if (value) return [{ ...header, value, source: 'header' }]
    const meta = header.name === CSP ? metaCsp?.trim() : undefined
    if (meta) return [{ ...header, value: meta, source: 'meta' }]
    return header.optional ? [] : [{ ...header, value: null, source: null }]
  })
}

export function headersSummaryText(checks: readonly HeaderCheck[]): string {
  const expected = checks.filter((c) => !c.optional)
  const present = expected.filter((c) => c.value !== null).length
  if (present === expected.length) return `Llegaron las ${expected.length} cabeceras que este sitio envía.`
  if (present === 0) return `No llegó ninguna de las ${expected.length} cabeceras en esta respuesta.`
  return `Llegaron ${present} de ${expected.length} cabeceras. ${
    expected.length - present === 1 ? 'Falta una' : `Faltan ${expected.length - present}`
  }.`
}

/** "OWASP A05:2021, configuración de seguridad incorrecta." */
export function owaspText({ code, name }: OwaspRisk): string {
  return `OWASP ${code}, ${name}`
}

export type Fetch = (input: string, init: RequestInit) => Promise<Response>

/** The page whose real answer the demo reads: the home page of the same origin. */
export const CHECKED_PATH = '/'

/**
 * The headers of the site's real answer. HEAD carries the same headers as GET without the body; servers that
 * refuse HEAD get a GET whose body is discarded. Errors (no connection) are left to the caller.
 */
export async function fetchSiteHeaders(
  fetchImpl: Fetch = (input, init) => fetch(input, init),
): Promise<Headers> {
  const init: RequestInit = { cache: 'no-store', credentials: 'same-origin', redirect: 'follow' }
  const head = await fetchImpl(CHECKED_PATH, { ...init, method: 'HEAD' })
  if (head.status !== 405 && head.status !== 501) return head.headers
  const get = await fetchImpl(CHECKED_PATH, { ...init, method: 'GET' })
  await get.body?.cancel().catch(() => {})
  return get.headers
}
