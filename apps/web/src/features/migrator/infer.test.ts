import { describe, expect, it } from 'vitest'
import { headerWords, inferColumn, looksLike, MIN_SHARE, SAMPLE_SIZE, sampleValues } from './infer'

describe('looksLike', () => {
  it('counts anything with an @ as an email, even if invalid', () => {
    expect(looksLike('email', 'ana@example.com')).toBe(true)
    expect(looksLike('email', 'pedro@example')).toBe(true)
    expect(looksLike('email', 'marta.example.com')).toBe(false)
  })

  it('recognises phones in common formats', () => {
    expect(looksLike('phone', '300 555 0101')).toBe(true)
    expect(looksLike('phone', '+57 (300) 555-0101')).toBe(true)
    expect(looksLike('phone', '(+57) 300 555 0101')).toBe(true)
    expect(looksLike('phone', '555 0108')).toBe(true)
  })

  it('does not take amounts or short numbers for phones', () => {
    expect(looksLike('phone', '$1.200.000')).toBe(false)
    expect(looksLike('phone', '2.500.000')).toBe(false)
    expect(looksLike('phone', '850000')).toBe(false)
    expect(looksLike('phone', '300 555 abc')).toBe(false)
  })

  it('recognises dates, including ones that do not exist', () => {
    expect(looksLike('date', '03/04/2024')).toBe(true)
    expect(looksLike('date', '31/02/2024')).toBe(true)
    expect(looksLike('date', '3 de abril de 2024')).toBe(true)
    expect(looksLike('date', 'Bogotá')).toBe(false)
  })

  it('recognises amounts, including malformed ones with a currency sign', () => {
    expect(looksLike('amount', '$1.200.000,50')).toBe(true)
    expect(looksLike('amount', '1200000.5')).toBe(true)
    expect(looksLike('amount', 'USD 1,250.00')).toBe(true)
    expect(looksLike('amount', '$1.2.3')).toBe(true)
    expect(looksLike('amount', 'mil doscientos')).toBe(false)
    expect(looksLike('amount', '2024-04-03')).toBe(false)
  })
})

describe('sampleValues', () => {
  it('returns every value when there are few', () => {
    expect(sampleValues(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('spreads the sample across the whole list', () => {
    const values = Array.from({ length: 1000 }, (_, i) => String(i))
    const sample = sampleValues(values, 10)
    expect(sample).toHaveLength(10)
    expect(sample[0]).toBe('0')
    expect(sample[9]).toBe('900')
  })

  it('caps the sample at SAMPLE_SIZE by default', () => {
    expect(sampleValues(Array.from({ length: 5000 }, () => 'x'))).toHaveLength(SAMPLE_SIZE)
  })
})

describe('headerWords', () => {
  it('splits keys on underscores', () => {
    expect(headerWords('fecha_de_registro')).toEqual(['fecha', 'de', 'registro'])
  })
})

describe('inferColumn', () => {
  it('uses the header hint when half the values agree', () => {
    const column = inferColumn('correo', ['ana@example.com', 'sin correo', 'luis@example.com', 'n/a'])
    expect(column).toMatchObject({ type: 'email', reason: 'header', sampled: 4, matched: 2 })
  })

  it('ignores a header hint the values do not back', () => {
    const column = inferColumn('telefono', ['no tiene', 'pendiente', 'llamar luego'])
    expect(column).toMatchObject({ type: 'text', reason: 'default' })
  })

  it('infers from the values when the header says nothing', () => {
    expect(inferColumn('contacto', ['ana@example.com', 'luis@example.com'])).toMatchObject({
      type: 'email',
      reason: 'values',
    })
    expect(inferColumn('x', ['03/04/2024', '2024-04-05', '3 de abril de 2024'])).toMatchObject({
      type: 'date',
      reason: 'values',
    })
    expect(inferColumn('x', ['$1.200.000,50', '850.000', '1200000.5'])).toMatchObject({
      type: 'amount',
      reason: 'values',
    })
    expect(inferColumn('x', ['300 555 0101', '+57 (310) 555-0102', '3125550103'])).toMatchObject({
      type: 'phone',
      reason: 'values',
    })
  })

  it('needs 80 % of the sample without a header hint', () => {
    const fourOfFive = ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'nada']
    expect(MIN_SHARE).toBe(0.8)
    expect(inferColumn('x', fourOfFive).type).toBe('email')
    // Three of four is 75 %: not enough without a hint, enough with one.
    expect(inferColumn('x', fourOfFive.slice(1)).type).toBe('text')
    expect(inferColumn('email', fourOfFive.slice(1)).type).toBe('email')
  })

  it('breaks ties in favour of phones over amounts', () => {
    expect(inferColumn('x', ['3005550101', '3105550102']).type).toBe('phone')
  })

  it('prefers the larger share when two types qualify', () => {
    // ISO dates also have phone-like digits, but all of them read as dates.
    expect(inferColumn('x', ['2024-04-03', '2024-04-05', '2024-05-01']).type).toBe('date')
  })

  it('keeps identifier columns as text whatever they contain', () => {
    expect(inferColumn('documento', ['1.023.456.789', '52.345.678'])).toMatchObject({
      type: 'text',
      reason: 'identifier',
    })
    expect(inferColumn('id_cliente', ['1', '2', '3']).type).toBe('text')
  })

  it('marks names and places for title case', () => {
    expect(inferColumn('nombre_completo', ['ana gómez'])).toMatchObject({ type: 'text', titleCase: true })
    expect(inferColumn('ciudad', ['bogotá'])).toMatchObject({ type: 'text', titleCase: true })
    expect(inferColumn('observaciones', ['llamar el lunes'])).toMatchObject({
      type: 'text',
      titleCase: false,
    })
  })

  it('treats an empty column as text', () => {
    expect(inferColumn('notas', ['', '  '])).toMatchObject({ type: 'text', reason: 'default', sampled: 0 })
  })
})
