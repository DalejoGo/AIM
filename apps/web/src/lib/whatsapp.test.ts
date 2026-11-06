import { describe, expect, it } from 'vitest'
import { whatsappLink } from './whatsapp'

describe('whatsappLink', () => {
  it('builds a plain link', () => {
    expect(whatsappLink('573027015524')).toBe('https://wa.me/573027015524')
  })

  it('encodes the prefilled message', () => {
    expect(whatsappLink('573027015524', ' Hola, quiero cotizar ')).toBe(
      'https://wa.me/573027015524?text=Hola%2C+quiero+cotizar',
    )
  })

  it('rejects numbers that are not international digits', () => {
    expect(() => whatsappLink('+57 302 701 5524')).toThrow()
  })
})
