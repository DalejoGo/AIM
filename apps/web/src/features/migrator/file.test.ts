import { describe, expect, it } from 'vitest'
import { checkFile, decodeCsv, formatBytes, formatCount, MAX_BYTES, MAX_ROWS } from './file'

const plain = (s: string) => s.replace(/\s/g, ' ')

describe('limits', () => {
  it('are 5 MB and 20.000 rows', () => {
    expect(MAX_BYTES).toBe(5 * 1024 * 1024)
    expect(MAX_ROWS).toBe(20_000)
  })
})

describe('formatBytes and formatCount', () => {
  it('formats sizes in Spanish', () => {
    expect(formatBytes(850)).toBe('850 bytes')
    expect(plain(formatBytes(3277))).toBe('3,2 KB')
    expect(plain(formatBytes(MAX_BYTES))).toBe('5 MB')
  })

  it('groups thousands with dots', () => {
    expect(formatCount(20000)).toBe('20.000')
  })
})

describe('checkFile', () => {
  it('accepts CSV and TXT files under the limit', () => {
    expect(checkFile('clientes.csv', 1000)).toBeNull()
    expect(checkFile('CLIENTES.CSV', 1000)).toBeNull()
    expect(checkFile('clientes.txt', 1000)).toBeNull()
    expect(checkFile('export', 1000, 'text/csv')).toBeNull()
  })

  it('accepts a file exactly at the limit', () => {
    expect(checkFile('clientes.csv', MAX_BYTES)).toBeNull()
  })

  it('rejects files over 5 MB and says how big they are', () => {
    const message = checkFile('clientes.csv', 7.3 * 1024 * 1024)
    expect(message && plain(message)).toContain('pesa 7,3 MB y el límite es 5 MB')
  })

  it('tells Excel users how to save as CSV', () => {
    expect(checkFile('clientes.xlsx', 1000)).toContain('«CSV UTF-8»')
  })

  it('rejects other kinds of files', () => {
    expect(checkFile('foto.png', 1000, 'image/png')).toContain('no es un CSV')
  })

  it('rejects empty files', () => {
    expect(checkFile('clientes.csv', 0)).toContain('vacío')
  })
})

describe('decodeCsv', () => {
  it('reads UTF-8', () => {
    expect(decodeCsv(new TextEncoder().encode('nombre\nGómez'))).toEqual({ ok: true, text: 'nombre\nGómez' })
  })

  it('falls back to Windows-1252 so Excel files keep their accents', () => {
    const bytes = new Uint8Array([0x47, 0xf3, 0x6d, 0x65, 0x7a, 0x3b, 0xd1])
    expect(decodeCsv(bytes)).toEqual({ ok: true, text: 'Gómez;Ñ' })
  })

  it('rejects binary or UTF-16 content', () => {
    const result = decodeCsv(new Uint8Array([0x61, 0x00, 0x62, 0x00]))
    expect(result.ok).toBe(false)
  })
})
