import { describe, expect, it } from 'vitest'
import {
  cleanText,
  dateParts,
  daysInMonth,
  expandYear,
  normalizeAmount,
  normalizeDate,
  normalizeEmail,
  normalizeHeader,
  normalizePhone,
  parseAmount,
  parseDate,
  stripAccents,
  toTitleCase,
  uniqueKeys,
} from './normalize'

describe('cleanText', () => {
  it('trims and collapses whitespace, tabs and line breaks', () => {
    expect(cleanText('  ana \t maría\n gómez  ')).toBe('ana maría gómez')
  })

  it('removes non-breaking and zero-width characters', () => {
    expect(cleanText('\u00a0ana\u200b gómez\ufeff')).toBe('ana gómez')
  })

  it('returns an empty string for blank input', () => {
    expect(cleanText('   ')).toBe('')
  })
})

describe('stripAccents', () => {
  it('removes accents and the tilde of ñ', () => {
    expect(stripAccents('Teléfono Año Ünico')).toBe('Telefono Ano Unico')
  })
})

describe('normalizeHeader', () => {
  it('turns headers into snake_case without accents', () => {
    expect(normalizeHeader(' Correo Electrónico ', 0)).toBe('correo_electronico')
    expect(normalizeHeader('Monto (COP)', 0)).toBe('monto_cop')
    expect(normalizeHeader('Fecha de registro', 0)).toBe('fecha_de_registro')
  })

  it('names empty or symbol-only headers by position', () => {
    expect(normalizeHeader('', 2)).toBe('columna_3')
    expect(normalizeHeader(' # ', 0)).toBe('columna_1')
  })
})

describe('uniqueKeys', () => {
  it('numbers repeated keys and leaves the first one alone', () => {
    expect(uniqueKeys(['nombre', 'correo', 'nombre', 'nombre'])).toEqual([
      'nombre',
      'correo',
      'nombre_2',
      'nombre_3',
    ])
  })

  it('skips numbers already taken', () => {
    expect(uniqueKeys(['a', 'a_2', 'a'])).toEqual(['a', 'a_2', 'a_3'])
  })
})

describe('toTitleCase', () => {
  it('capitalises each word and fixes extra spaces', () => {
    expect(toTitleCase('  ana maría  GÓMEZ ')).toBe('Ana María Gómez')
  })

  it('keeps Spanish particles in lower case except at the start', () => {
    expect(toTitleCase('MARÍA DE LOS ÁNGELES TORRES')).toBe('María de los Ángeles Torres')
    expect(toTitleCase('josé del carmen pérez y sánchez')).toBe('José del Carmen Pérez y Sánchez')
    expect(toTitleCase('la dorada')).toBe('La Dorada')
  })

  it('capitalises after hyphens and apostrophes', () => {
    expect(toTitleCase('ana-maría o’neill')).toBe('Ana-María O’Neill')
    expect(toTitleCase("d'angelo")).toBe("D'Angelo")
  })

  it('writes initials in upper case', () => {
    expect(toTitleCase('bogotá d.c.')).toBe('Bogotá D.C.')
  })

  it('handles ñ and accented capitals', () => {
    expect(toTitleCase('ÑUSTA ÁLVAREZ')).toBe('Ñusta Álvarez')
  })
})

describe('normalizeEmail', () => {
  it('lower-cases and trims', () => {
    expect(normalizeEmail(' Ana.Gomez@Example.COM ')).toBe('ana.gomez@example.com')
  })

  it('removes spaces around @ and dots', () => {
    expect(normalizeEmail('ana.gomez @ example . com')).toBe('ana.gomez@example.com')
  })

  it('drops a mailto: prefix', () => {
    expect(normalizeEmail('mailto:Ana@Example.com')).toBe('ana@example.com')
  })

  it('keeps spaces inside a word so validation can flag them', () => {
    expect(normalizeEmail('camilo vargas@example.com')).toBe('camilo vargas@example.com')
  })
})

describe('normalizePhone', () => {
  it('adds +57 to 10-digit numbers that start with 3', () => {
    expect(normalizePhone('300 555 0101')).toBe('+573005550101')
    expect(normalizePhone('3005550101')).toBe('+573005550101')
    expect(normalizePhone('300-555-0101')).toBe('+573005550101')
    expect(normalizePhone('300.555.0101')).toBe('+573005550101')
    expect(normalizePhone('(300) 555 0101')).toBe('+573005550101')
  })

  it('keeps a written country code', () => {
    expect(normalizePhone('+57 (300) 555-0101')).toBe('+573005550101')
    expect(normalizePhone('(+57) 300 555 0101')).toBe('+573005550101')
    expect(normalizePhone('+1 (415) 555-0117')).toBe('+14155550117')
  })

  it('reads 00 as the international prefix', () => {
    expect(normalizePhone('0057 300 555 0101')).toBe('+573005550101')
  })

  it('adds the + to 12 digits that start with 573', () => {
    expect(normalizePhone('57 300 555 0101')).toBe('+573005550101')
  })

  it('leaves numbers it cannot place as they are, cleaned', () => {
    expect(normalizePhone(' 555  0108 ')).toBe('555 0108')
    expect(normalizePhone('601 555 0118')).toBe('601 555 0118')
    expect(normalizePhone('300 555 0101 ext 12')).toBe('300 555 0101 ext 12')
  })

  it('leaves numbers that would not be valid E.164 as the person wrote them', () => {
    expect(normalizePhone('+57 300 555 01')).toBe('+57 300 555 01')
    expect(normalizePhone('+1 234')).toBe('+1 234')
  })
})

describe('expandYear and daysInMonth', () => {
  it('reads two-digit years with a pivot at 50', () => {
    expect(expandYear('25')).toBe(2025)
    expect(expandYear('49')).toBe(2049)
    expect(expandYear('50')).toBe(1950)
    expect(expandYear('2024')).toBe(2024)
  })

  it('knows month lengths and leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2023, 2)).toBe(28)
    expect(daysInMonth(1900, 2)).toBe(28)
    expect(daysInMonth(2000, 2)).toBe(29)
    expect(daysInMonth(2024, 4)).toBe(30)
    expect(daysInMonth(2024, 12)).toBe(31)
  })
})

describe('parseDate', () => {
  it('reads numeric dates day first', () => {
    expect(parseDate('03/04/2024')).toBe('2024-04-03')
    expect(parseDate('3/4/2024')).toBe('2024-04-03')
    expect(parseDate('03-04-2024')).toBe('2024-04-03')
    expect(parseDate('03.04.2024')).toBe('2024-04-03')
    expect(parseDate('5/5/25')).toBe('2025-05-05')
  })

  it('reads year-first dates', () => {
    expect(parseDate('2024-04-03')).toBe('2024-04-03')
    expect(parseDate('2024/4/3')).toBe('2024-04-03')
  })

  it('reads Spanish month names, full or short', () => {
    expect(parseDate('3 de abril de 2024')).toBe('2024-04-03')
    expect(parseDate('3 De Abril Del 2024')).toBe('2024-04-03')
    expect(parseDate('7 abr 2024')).toBe('2024-04-07')
    expect(parseDate('7 abr. 2024')).toBe('2024-04-07')
    expect(parseDate('3-abr-24')).toBe('2024-04-03')
    expect(parseDate('julio 1, 2025')).toBe('2025-07-01')
    expect(parseDate('15 de setiembre de 2024')).toBe('2024-09-15')
    expect(parseDate('1 sept 2024')).toBe('2024-09-01')
    expect(parseDate('24 dic 2024')).toBe('2024-12-24')
  })

  it('ignores a weekday before the date and a time after it', () => {
    expect(parseDate('miércoles 9 de abril de 2025')).toBe('2025-04-09')
    expect(parseDate('Lunes, 3 de marzo de 2025')).toBe('2025-03-03')
    expect(parseDate('03/04/2024 10:30')).toBe('2024-04-03')
    expect(parseDate('03/04/2024 10:30 a. m.')).toBe('2024-04-03')
    expect(parseDate('2024-04-03T10:30:00Z')).toBe('2024-04-03')
  })

  it('rejects dates that do not exist', () => {
    expect(parseDate('31/02/2024')).toBeNull()
    expect(parseDate('29/02/2023')).toBeNull()
    expect(parseDate('04/13/2024')).toBeNull()
    expect(parseDate('00/01/2024')).toBeNull()
    expect(parseDate('2024-13-01')).toBeNull()
  })

  it('accepts 29 February in leap years', () => {
    expect(parseDate('29/02/2024')).toBe('2024-02-29')
  })

  it('rejects years outside 1900 to 2100', () => {
    expect(parseDate('01/01/1850')).toBeNull()
    expect(parseDate('01/01/2150')).toBeNull()
  })

  it('rejects text that is not a date', () => {
    expect(parseDate('ayer')).toBeNull()
    expect(parseDate('3 de abrill de 2024')).toBeNull()
    expect(parseDate('20240403')).toBeNull()
    expect(parseDate('3 constructor 2024')).toBeNull()
    expect(parseDate('')).toBeNull()
  })
})

describe('dateParts', () => {
  it('returns the parts even when the date does not exist', () => {
    expect(dateParts('31/02/2024')).toEqual({ year: 2024, month: 2, day: 31 })
    expect(dateParts('04/13/2024')).toEqual({ year: 2024, month: 13, day: 4 })
  })
})

describe('normalizeDate', () => {
  it('returns ISO dates', () => {
    expect(normalizeDate(' 3 de abril de 2024 ')).toBe('2024-04-03')
  })

  it('leaves unreadable dates cleaned but unchanged', () => {
    expect(normalizeDate(' 31/02/2024 ')).toBe('31/02/2024')
  })
})

describe('parseAmount', () => {
  it('reads Latin American format: dots for thousands, comma for decimals', () => {
    expect(parseAmount('$1.200.000,50')).toBe(1200000.5)
    expect(parseAmount('$ 2.500.000')).toBe(2500000)
    expect(parseAmount('640.000,00')).toBe(640000)
    expect(parseAmount('12,5')).toBe(12.5)
  })

  it('reads plain and US formats', () => {
    expect(parseAmount('1200000.5')).toBe(1200000.5)
    expect(parseAmount('1,200,000.50')).toBe(1200000.5)
    expect(parseAmount('USD 1,250.00')).toBe(1250)
    expect(parseAmount('350000')).toBe(350000)
  })

  it('reads a single separator followed by three digits as thousands', () => {
    expect(parseAmount('850.000')).toBe(850000)
    expect(parseAmount('1,500')).toBe(1500)
  })

  it('reads a single separator as decimal when it cannot be thousands', () => {
    expect(parseAmount('0.500')).toBe(0.5)
    expect(parseAmount('1234.567')).toBe(1234.567)
    expect(parseAmount('99.9')).toBe(99.9)
  })

  it('handles currency codes, signs and accounting parentheses', () => {
    expect(parseAmount('COP 450.000')).toBe(450000)
    expect(parseAmount('450.000 pesos')).toBe(450000)
    expect(parseAmount('€ 99,90')).toBe(99.9)
    expect(parseAmount('-$1.200')).toBe(-1200)
    expect(parseAmount('$-1.200')).toBe(-1200)
    expect(parseAmount('($1.200)')).toBe(-1200)
    expect(parseAmount('+500')).toBe(500)
  })

  it('rejects malformed numbers and text', () => {
    expect(parseAmount('$1.2.3')).toBeNull()
    expect(parseAmount('12.34.567')).toBeNull()
    expect(parseAmount('1,200.000,50')).toBeNull()
    expect(parseAmount('1.234,5,6')).toBeNull()
    expect(parseAmount('1.')).toBeNull()
    expect(parseAmount('mil doscientos')).toBeNull()
    expect(parseAmount('1 200 000')).toBeNull()
    expect(parseAmount('$')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })
})

describe('normalizeAmount', () => {
  it('returns a number when it can', () => {
    expect(normalizeAmount(' $ 980.500 ')).toBe(980500)
  })

  it('returns the cleaned text when it cannot', () => {
    expect(normalizeAmount('  mil   doscientos ')).toBe('mil doscientos')
  })
})
