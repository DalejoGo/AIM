import { describe, expect, it } from 'vitest'
import { E164 } from './normalize'
import type { Column, ColumnType } from './types'
import {
  buildRowSchema,
  describeAmountProblem,
  describeDateProblem,
  describeEmailProblem,
  describePhoneProblem,
  fieldSchema,
  validateRow,
} from './validate'

const column = (key: string, type: ColumnType, label = key): Column => ({
  index: 0,
  label,
  key,
  type,
  titleCase: false,
  reason: 'header',
  sampled: 0,
  matched: 0,
})

const messageOf = (type: ColumnType, value: unknown) => {
  const parsed = fieldSchema(type).safeParse(value)
  return parsed.success ? null : parsed.error.issues[0]?.message
}

describe('E164', () => {
  it('accepts Colombian numbers with 10 digits after +57', () => {
    expect(E164.test('+573005550101')).toBe(true)
    expect(E164.test('+576015550118')).toBe(true)
    expect(E164.test('+5730055501')).toBe(false)
    expect(E164.test('+5730055501011')).toBe(false)
  })

  it('accepts other countries with 8 to 15 digits', () => {
    expect(E164.test('+14155550117')).toBe(true)
    expect(E164.test('+1234567')).toBe(false)
    expect(E164.test('+1234567890123456')).toBe(false)
    expect(E164.test('+04155550117')).toBe(false)
    expect(E164.test('3005550101')).toBe(false)
  })
})

describe('fieldSchema', () => {
  it('lets empty cells through as null for every type', () => {
    for (const type of ['email', 'phone', 'date', 'amount', 'text'] as const) {
      expect(fieldSchema(type).safeParse(null).success).toBe(true)
    }
  })

  it('validates emails', () => {
    expect(messageOf('email', 'ana@example.com')).toBeNull()
    expect(messageOf('email', 'pedro@example')).toContain('extensión de dominio')
  })

  it('validates E.164 phones', () => {
    expect(messageOf('phone', '+573005550101')).toBeNull()
    expect(messageOf('phone', '555 0108')).toContain('7 dígitos')
  })

  it('validates ISO dates', () => {
    expect(messageOf('date', '2024-02-29')).toBeNull()
    expect(messageOf('date', '31/02/2024')).toContain('febrero de 2024 tiene 29 días')
  })

  it('validates amounts as numbers', () => {
    expect(messageOf('amount', 1200000.5)).toBeNull()
    expect(messageOf('amount', 'mil doscientos')).toContain('tiene letras')
  })

  it('accepts any text', () => {
    expect(messageOf('text', 'lo que sea')).toBeNull()
  })
})

describe('describeEmailProblem', () => {
  it('explains each kind of mistake', () => {
    expect(describeEmailProblem('marta.example.com')).toContain('le falta la @')
    expect(describeEmailProblem('a@b@example.com')).toContain('más de una @')
    expect(describeEmailProblem('camilo vargas@example.com')).toContain('tiene espacios')
    expect(describeEmailProblem('@example.com')).toContain('nada antes de la @')
    expect(describeEmailProblem('pedro@example')).toContain('extensión de dominio')
    expect(describeEmailProblem('josé@example.com')).toContain('tildes')
  })

  it('quotes the value it is talking about', () => {
    expect(describeEmailProblem('marta.example.com')).toContain('«marta.example.com»')
  })
})

describe('describePhoneProblem', () => {
  it('flags letters', () => {
    expect(describePhoneProblem('300 555 0101 ext 12')).toContain('letras o símbolos')
  })

  it('counts the national digits of +57 numbers', () => {
    expect(describePhoneProblem('+57 300 555 01')).toContain('«+57 300 555 01» tiene 8')
  })

  it('explains the length of other international numbers', () => {
    expect(describePhoneProblem('+1234')).toContain('entre 8 y 15')
  })

  it('asks for the country code on 10 digits that are not a mobile', () => {
    expect(describePhoneProblem('601 555 0118')).toContain('indicativo')
  })

  it('says how many digits a short number has', () => {
    expect(describePhoneProblem('31255501')).toContain('tiene 8 dígitos')
  })
})

describe('describeDateProblem', () => {
  it('spots month/day order and suggests the fix', () => {
    const message = describeDateProblem('04/13/2024')
    expect(message).toContain('no hay mes 13')
    expect(message).toContain('13/04/2024')
  })

  it('says how many days the month has', () => {
    expect(describeDateProblem('31/04/2024')).toContain('abril de 2024 tiene 30 días')
  })

  it('flags years out of range', () => {
    expect(describeDateProblem('01/01/1850')).toContain('fuera del rango')
  })

  it('lists the accepted formats for text it cannot read', () => {
    expect(describeDateProblem('ayer')).toContain('Usa día/mes/año')
  })
})

describe('describeAmountProblem', () => {
  it('flags letters but not currency codes', () => {
    expect(describeAmountProblem('mil doscientos')).toContain('tiene letras')
    expect(describeAmountProblem('COP 1.2.3')).toContain('No se entiende')
  })

  it('explains the separators for malformed numbers', () => {
    expect(describeAmountProblem('$1.2.3')).toContain('puntos para los miles')
  })
})

describe('buildRowSchema and validateRow', () => {
  const columns = [
    column('nombre', 'text', 'Nombre'),
    column('correo', 'email', 'Correo'),
    column('telefono', 'phone', 'Teléfono'),
    column('fecha', 'date', 'Fecha'),
    column('monto', 'amount', 'Monto'),
  ]
  const schema = buildRowSchema(columns)

  it('passes a clean row', () => {
    const row = {
      nombre: 'Ana',
      correo: 'ana@example.com',
      telefono: '+573005550101',
      fecha: '2024-04-03',
      monto: 1,
    }
    expect(validateRow(schema, columns, row)).toEqual([])
  })

  it('passes a row with empty cells', () => {
    const row = { nombre: 'Ana', correo: null, telefono: null, fecha: null, monto: null }
    expect(validateRow(schema, columns, row)).toEqual([])
  })

  it('returns one error per failing field, in column order, with its label', () => {
    const row = { nombre: 'Ana', correo: 'ana@', telefono: '555', fecha: '2024-02-30', monto: 'mucho' }
    const errors = validateRow(schema, columns, row)
    expect(errors.map((error) => error.key)).toEqual(['correo', 'telefono', 'fecha', 'monto'])
    expect(errors.map((error) => error.label)).toEqual(['Correo', 'Teléfono', 'Fecha', 'Monto'])
  })
})
