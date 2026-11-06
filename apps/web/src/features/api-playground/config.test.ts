import { describe, expect, it } from 'vitest'
import { docsUrl, playgroundApiUrl } from './config'

describe('playgroundApiUrl', () => {
  it('keeps absolute http(s) URLs without the trailing slash', () => {
    expect(playgroundApiUrl('https://aimweb-api.onrender.com')).toBe('https://aimweb-api.onrender.com')
    expect(playgroundApiUrl(' https://aimweb-api.onrender.com/ ')).toBe('https://aimweb-api.onrender.com')
    expect(playgroundApiUrl('http://localhost:3000')).toBe('http://localhost:3000')
    expect(playgroundApiUrl('https://api.example.com/base//')).toBe('https://api.example.com/base')
  })

  it('is null when missing, so the page shows the "not configured" notice', () => {
    expect(playgroundApiUrl(undefined)).toBeNull()
    expect(playgroundApiUrl(null)).toBeNull()
    expect(playgroundApiUrl('')).toBeNull()
    expect(playgroundApiUrl('   ')).toBeNull()
  })

  it('rejects anything that is not a plain absolute http(s) URL', () => {
    expect(playgroundApiUrl('aimweb-api.onrender.com')).toBeNull()
    expect(playgroundApiUrl('/api')).toBeNull()
    expect(playgroundApiUrl('ftp://api.example.com')).toBeNull()
    expect(playgroundApiUrl('javascript:alert(1)')).toBeNull()
    expect(playgroundApiUrl('https://api.example.com/?x=1')).toBeNull()
    expect(playgroundApiUrl('https://user:secret@api.example.com')).toBeNull()
  })
})

describe('docsUrl', () => {
  it('points at Swagger UI', () => {
    expect(docsUrl('https://aimweb-api.onrender.com')).toBe('https://aimweb-api.onrender.com/docs')
  })
})
