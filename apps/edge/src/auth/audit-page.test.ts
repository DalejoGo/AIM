import { describe, expect, it } from 'vitest'
import { AuditQuery, decodeCursor, encodeCursor } from './audit-page'

const cursor = { at: '2026-11-06T15:00:00.123456Z', id: '0b6f2a2e-6c1f-4d8a-9a51-2f1f0f6e9c11' }

describe('audit cursor', () => {
  it('round-trips and stays URL-safe', () => {
    const encoded = encodeCursor(cursor)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeCursor(encoded)).toEqual(cursor)
  })

  it('rejects anything it did not produce', () => {
    expect(decodeCursor('no-es-un-cursor')).toBeNull()
    expect(decodeCursor(Buffer.from('{"at":"ayer","id":"x"}').toString('base64url'))).toBeNull()
    expect(decodeCursor(Buffer.from("'; drop table audit_log; --").toString('base64url'))).toBeNull()
  })
})

describe('audit query', () => {
  it('treats blank values as missing', () => {
    expect(AuditQuery.parse({ cursor: '', limit: '' })).toEqual({ limit: 20 })
    expect(AuditQuery.parse({})).toEqual({ limit: 20 })
    expect(AuditQuery.parse({ limit: '100' })).toEqual({ limit: 100 })
  })

  it('rejects limits out of range', () => {
    expect(AuditQuery.safeParse({ limit: '101' }).success).toBe(false)
    expect(AuditQuery.safeParse({ limit: '0' }).success).toBe(false)
    expect(AuditQuery.safeParse({ limit: '2.5' }).success).toBe(false)
  })
})
