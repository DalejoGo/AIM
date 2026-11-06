import { CreateLead } from '@aim/contracts'
import { describe, expect, it } from 'vitest'
import { normalizePhone } from './phone'

describe('normalizePhone', () => {
  it.each([
    ['+57 300 123 4567', '573001234567'],
    ['+1 (305) 555-1234', '13055551234'],
    ['0057 300 123 4567', '573001234567'],
    ['300 123 4567', '573001234567'],
    ['(300) 123-4567', '573001234567'],
    ['300.123.4567', '573001234567'],
    ['57 300 123 4567', '573001234567'],
    ['34 612 345 678', '34612345678'],
  ])('reads %s as %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected)
  })

  it('leaves an empty field out', () => {
    expect(normalizePhone('')).toBeUndefined()
    expect(normalizePhone('   ')).toBeUndefined()
  })

  it('only assumes Colombia for ten-digit numbers that start with 3', () => {
    expect(normalizePhone('601 234 5678')).toBe('6012345678')
    expect(normalizePhone('30 0123 456')).toBe('300123456')
  })

  it('gives the contract what it expects, and lets it reject numbers that are too short or have no digits', () => {
    const accepts = (raw: string) =>
      CreateLead.safeParse({
        name: 'Ana',
        phone: normalizePhone(raw),
        service: 'web',
        message: 'Quiero una página web.',
        consent: true,
      }).success
    expect(accepts('+57 300 123 4567')).toBe(true)
    expect(accepts('300 123 4567')).toBe(true)
    expect(accepts('300 12')).toBe(false)
    expect(normalizePhone('no tengo')).toBe('')
    expect(accepts('no tengo')).toBe(false)
  })
})
