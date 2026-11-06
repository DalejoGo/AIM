import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import { exportName, FORMULA_START, toCleanCsv, toErrorsCsv } from './export'
import { runMigration } from './pipeline'
import { SAMPLE_CSV } from './sample'

function migrate(text: string) {
  const outcome = runMigration(text)
  if (!outcome.ok) throw new Error(outcome.error)
  return outcome.result
}

const parse = (csv: string) => Papa.parse<string[]>(csv, { delimitersToGuess: [',', ';'] }).data

describe('toCleanCsv', () => {
  const sample = migrate(SAMPLE_CSV)

  it('writes normalised headers and only valid rows, with the source separator', () => {
    const rows = parse(toCleanCsv(sample))
    expect(rows[0]).toEqual([
      'nombre_completo',
      'correo_electronico',
      'telefono',
      'fecha_de_registro',
      'monto_cop',
      'ciudad',
    ])
    expect(rows).toHaveLength(1 + sample.valid.length)
    expect(rows[1]).toEqual([
      'Ana María Gómez',
      'ana.gomez@example.com',
      '+573005550101',
      '2024-04-03',
      '1200000.5',
      'Bogotá',
    ])
    expect(toCleanCsv(sample).split('\r\n')[0]).toContain(';')
  })

  it('writes empty cells as empty fields', () => {
    const row = parse(toCleanCsv(sample)).find((fields) => fields[0] === 'Esteban Quintero')
    expect(row).toEqual([
      'Esteban Quintero',
      'esteban.quintero@example.com',
      '+573105550119',
      '',
      '',
      'Popayán',
    ])
  })

  it('quotes values that contain the separator', () => {
    const result = migrate('nota;correo\n"uno; dos";ana@example.com')
    expect(toCleanCsv(result)).toContain('"uno; dos"')
  })
})

describe('toErrorsCsv', () => {
  const sample = migrate(SAMPLE_CSV)
  const rows = parse(toErrorsCsv(sample))

  it('keeps the original headers and adds the row number and the errors', () => {
    expect(rows[0]).toEqual([
      'fila',
      'Nombre completo',
      'Correo Electrónico',
      'Teléfono',
      'Fecha de registro',
      'Monto (COP)',
      'Ciudad',
      'errores',
    ])
    expect(rows).toHaveLength(1 + sample.invalid.length)
  })

  it('writes the values as they came in the file', () => {
    expect(rows[1]?.slice(0, 3)).toEqual(['8', 'pedro salazar', 'pedro.salazar@example'])
  })

  it('joins several errors of a row', () => {
    const row = rows.find((fields) => fields[0] === '28')
    expect(row?.at(-1)).toMatch(/^Correo Electrónico: .+ \/ Teléfono: .+/)
  })
})

describe('formula escaping', () => {
  it('escapes cells a spreadsheet would run', () => {
    expect(FORMULA_START.test('=SUMA(A1)')).toBe(true)
    expect(FORMULA_START.test('@cmd')).toBe(true)
    expect(FORMULA_START.test('+SUMA(A1)')).toBe(true)
    expect(FORMULA_START.test('-2+3')).toBe(true)
  })

  it('leaves phones and negative numbers alone', () => {
    expect(FORMULA_START.test('+573005550101')).toBe(false)
    expect(FORMULA_START.test('-1200.5')).toBe(false)
    expect(FORMULA_START.test('+57 (300) 555-0101')).toBe(false)
  })

  it('is applied to both exports', () => {
    const result = migrate('nombre;nota\nAna;=HIPERVINCULO("x")\nLuis;=1+1')
    expect(toCleanCsv(result)).toContain(`"'=HIPERVINCULO(""x"")"`)
  })
})

describe('exportName', () => {
  it('adds a suffix before the extension', () => {
    expect(exportName('clientes.csv', 'limpio')).toBe('clientes-limpio.csv')
    expect(exportName('base.final.txt', 'errores')).toBe('base.final-errores.csv')
    expect(exportName('', 'limpio')).toBe('datos-limpio.csv')
  })
})
