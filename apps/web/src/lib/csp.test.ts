import { describe, expect, it } from 'vitest'
import { CSP_SCRIPT_RESOURCES, cspDirectives, cspHash, cspOrigin, TURNSTILE_ORIGIN } from './csp'

const directive = (directives: string[], name: string) =>
  directives
    .find((d) => d.split(' ')[0] === name)
    ?.split(' ')
    .slice(1)

describe('cspDirectives', () => {
  it('allows only the site itself by default', () => {
    const directives = cspDirectives()
    expect(directive(directives, 'default-src')).toEqual(["'self'"])
    expect(directive(directives, 'connect-src')).toEqual(["'self'"])
    expect(directive(directives, 'img-src')).toEqual(["'self'", 'data:'])
    expect(directive(directives, 'font-src')).toEqual(["'self'"])
    expect(directive(directives, 'media-src')).toEqual(["'self'"])
    expect(directive(directives, 'object-src')).toEqual(["'none'"])
    expect(directive(directives, 'base-uri')).toEqual(["'self'"])
    expect(directive(directives, 'form-action')).toEqual(["'self'"])
  })

  it('lets Turnstile load its script and its challenge frame', () => {
    expect(TURNSTILE_ORIGIN).toBe('https://challenges.cloudflare.com')
    expect(directive(cspDirectives(), 'frame-src')).toEqual([TURNSTILE_ORIGIN])
    expect(CSP_SCRIPT_RESOURCES).toEqual(["'self'", TURNSTILE_ORIGIN])
  })

  it('leaves script-src and style-src to Astro, which adds the hashes', () => {
    const names = cspDirectives().map((d) => d.split(' ')[0])
    expect(names.filter((name) => name?.startsWith('script-src') || name?.startsWith('style-src'))).toEqual(
      [],
    )
  })

  it('adds the origin of each configured API to connect-src once', () => {
    const directives = cspDirectives({
      connectTo: ['https://aim-api.example.com/v1/', undefined, '  ', 'https://aim-api.example.com/health'],
    })
    expect(directive(directives, 'connect-src')).toEqual(["'self'", 'https://aim-api.example.com'])
  })
})

describe('cspOrigin', () => {
  it('keeps the scheme, host and port only', () => {
    expect(cspOrigin('http://localhost:3000/docs')).toBe('http://localhost:3000')
  })

  it('fails the build on a value that is not an http(s) URL', () => {
    expect(() => cspOrigin('aim-api.example.com')).toThrow(/PUBLIC_PLAYGROUND_API_URL/)
    expect(() => cspOrigin('javascript:alert(1)')).toThrow(/https/)
  })
})

describe('cspHash', () => {
  it('is the base64 SHA-256 of the exact text, as CSP expects', () => {
    // Reference value: printf '' | openssl dgst -sha256 -binary | base64
    expect(cspHash('')).toBe('sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=')
    expect(cspHash('a')).not.toBe(cspHash('a '))
  })
})
