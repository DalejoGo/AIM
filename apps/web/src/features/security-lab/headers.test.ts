import { describe, expect, it } from 'vitest'
import {
  CHECKED_PATH,
  CSP,
  checkHeaders,
  fetchSiteHeaders,
  headersSummaryText,
  owaspText,
  SECURITY_HEADERS,
} from './headers'

/** The six headers of apps/web/public/_headers, with the values the site sends. */
const SITE = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

describe('SECURITY_HEADERS', () => {
  it('explains every header in one sentence and maps it to an OWASP 2021 category', () => {
    for (const header of SECURITY_HEADERS) {
      expect(header.stops).toMatch(/^[A-ZÁÉÍÓÚ].+\.$/)
      expect(header.stops.split('. ')).toHaveLength(1)
      expect(header.owasp.code).toMatch(/^A\d{2}:2021$/)
    }
    expect(SECURITY_HEADERS.filter((h) => h.optional).map((h) => h.name)).toEqual([CSP])
  })
})

describe('checkHeaders', () => {
  it('shows each header with the value it arrived with', () => {
    const checks = checkHeaders(new Headers(SITE))

    expect(checks.map((c) => [c.name, c.value, c.source])).toEqual(
      Object.entries(SITE).map(([name, value]) => [name, value, 'header']),
    )
  })

  it('marks what did not arrive instead of making it up, and leaves the CSP out when it is absent', () => {
    const { 'X-Frame-Options': _gone, ...rest } = SITE
    const checks = checkHeaders(new Headers(rest))

    expect(checks).toHaveLength(6)
    expect(checks.find((c) => c.name === 'X-Frame-Options')).toMatchObject({ value: null, source: null })
    expect(checks.some((c) => c.name === CSP)).toBe(false)
    expect(checkHeaders(new Headers()).every((c) => c.value === null)).toBe(true)
  })

  it('treats an empty value as missing', () => {
    const checks = checkHeaders(new Headers({ ...SITE, 'X-Frame-Options': '  ' }))
    expect(checks.find((c) => c.name === 'X-Frame-Options')?.value).toBeNull()
  })

  it('lists the CSP from the HTTP answer, or from the meta tag of the page', () => {
    const policy = "default-src 'self'; script-src 'self' 'sha256-abc='"

    const fromHeader = checkHeaders(new Headers({ ...SITE, [CSP]: policy }), "default-src 'none'")
    expect(fromHeader.at(-1)).toMatchObject({ name: CSP, value: policy, source: 'header' })

    const fromMeta = checkHeaders(new Headers(SITE), ` ${policy} `)
    expect(fromMeta.at(-1)).toMatchObject({ name: CSP, value: policy, source: 'meta' })
    expect(fromMeta.at(-1)?.owasp.code).toBe('A03:2021')
  })
})

describe('headersSummaryText', () => {
  it('counts only the headers the site always sends', () => {
    expect(headersSummaryText(checkHeaders(new Headers(SITE), "default-src 'self'"))).toBe(
      'Llegaron las 6 cabeceras que este sitio envía.',
    )
    const { 'X-Frame-Options': _a, 'Referrer-Policy': _b, ...four } = SITE
    expect(headersSummaryText(checkHeaders(new Headers(four)))).toBe('Llegaron 4 de 6 cabeceras. Faltan 2.')
    const { 'X-Frame-Options': _c, ...five } = SITE
    expect(headersSummaryText(checkHeaders(new Headers(five)))).toBe('Llegaron 5 de 6 cabeceras. Falta una.')
    expect(headersSummaryText(checkHeaders(new Headers()))).toBe(
      'No llegó ninguna de las 6 cabeceras en esta respuesta.',
    )
  })
})

describe('owaspText', () => {
  it('names the category with its code', () => {
    expect(owaspText({ code: 'A05:2021', name: 'configuración de seguridad incorrecta' })).toBe(
      'OWASP A05:2021, configuración de seguridad incorrecta',
    )
  })
})

describe('fetchSiteHeaders', () => {
  it('reads the headers of a HEAD request to the home page of the same origin, never cached', async () => {
    const calls: { input: string; init: RequestInit }[] = []
    const headers = await fetchSiteHeaders(async (input, init) => {
      calls.push({ input, init })
      return new Response(null, { status: 200, headers: SITE })
    })

    expect(headers.get('X-Frame-Options')).toBe('DENY')
    expect(calls).toEqual([
      {
        input: CHECKED_PATH,
        init: { method: 'HEAD', cache: 'no-store', credentials: 'same-origin', redirect: 'follow' },
      },
    ])
  })

  it('falls back to GET when the server refuses HEAD', async () => {
    const methods: (string | undefined)[] = []
    const headers = await fetchSiteHeaders(async (_input, init) => {
      methods.push(init.method)
      return init.method === 'HEAD'
        ? new Response(null, { status: 405 })
        : new Response('<!doctype html>', { status: 200, headers: SITE })
    })

    expect(methods).toEqual(['HEAD', 'GET'])
    expect(headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin')
  })

  it('reads the headers of any answer: a 404 still carries them', async () => {
    const headers = await fetchSiteHeaders(async () => new Response(null, { status: 404, headers: SITE }))
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('lets a network failure reach the caller', async () => {
    await expect(
      fetchSiteHeaders(async () => {
        throw new TypeError('Failed to fetch')
      }),
    ).rejects.toThrow('Failed to fetch')
  })
})
