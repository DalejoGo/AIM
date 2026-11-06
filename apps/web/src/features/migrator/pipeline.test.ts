import { describe, expect, it } from 'vitest'
import { MAX_ROWS } from './file'
import {
  detectColumns,
  detectDelimiter,
  isEmptyRecord,
  normalizeRow,
  normalizeValue,
  pickShowcaseRow,
  readCsv,
  rowSignature,
  runMigration,
  structuralError,
} from './pipeline'
import { SAMPLE_CSV } from './sample'
import type { Column, MigrationResult, ProcessedRow } from './types'

function migrate(text: string): MigrationResult {
  const outcome = runMigration(text)
  if (!outcome.ok) throw new Error(outcome.error)
  return outcome.result
}

function readOk(text: string) {
  const read = readCsv(text)
  if (!read.ok) throw new Error(read.error)
  return read
}

const textColumn = (key: string, index: number, titleCase = false): Column => ({
  index,
  label: key,
  key,
  type: 'text',
  titleCase,
  reason: 'default',
  sampled: 0,
  matched: 0,
})

describe('detectDelimiter', () => {
  it('lets PapaParse decide when the rows are consistent', () => {
    expect(detectDelimiter('a;b;c\n1;2,5;3\n4;5,5;6\n7;8;9')).toBe(';')
    expect(detectDelimiter('a,b,c\n1,"2;5",3\n4,5,6')).toBe(',')
  })

  it('falls back to the header for short or irregular files', () => {
    expect(detectDelimiter('nombre;correo\n;\n\n')).toBe(';')
    expect(detectDelimiter('a;b\n1;2\n"3;4\n5;6')).toBe(';')
    expect(detectDelimiter('"nombre, apellido";correo\nAna')).toBe(';')
  })

  it('defaults to comma for a single column', () => {
    expect(detectDelimiter('nombre\nAna\nLuis')).toBe(',')
  })
})

describe('readCsv', () => {
  it('detects semicolons', () => {
    expect(readOk('a;b\n1;2').delimiter).toBe(';')
  })

  it('detects commas', () => {
    expect(readOk('a,b\n1,2').delimiter).toBe(',')
  })

  it('falls back to a comma for a single column', () => {
    expect(readOk('nombre\nAna\nLuis').delimiter).toBe(',')
  })

  it('takes the first row as the header and numbers data rows like a spreadsheet', () => {
    const read = readOk('nombre;correo\nAna;ana@example.com\nLuis;luis@example.com')
    expect(read.header).toEqual(['nombre', 'correo'])
    expect(read.headerRow).toBe(1)
    expect(read.rows.map((row) => row.rowNumber)).toEqual([2, 3])
  })

  it('removes a byte order mark from the first header', () => {
    expect(readOk('\ufeffnombre;correo\nAna;a@example.com').header[0]).toBe('nombre')
  })

  it('ignores the final line break but keeps blank lines in the middle', () => {
    const read = readOk('a;b\n1;2\n\n3;4\n')
    expect(read.rows.map((row) => row.fields)).toEqual([['1', '2'], [''], ['3', '4']])
  })

  it('handles Windows line breaks and quoted fields with separators and line breaks', () => {
    const read = readOk('nombre;nota\r\n"Gómez; Ana";"línea 1\nlínea 2"\r\n')
    expect(read.rows[0]?.fields).toEqual(['Gómez; Ana', 'línea 1\nlínea 2'])
  })

  it('skips blank lines before the header', () => {
    const read = readOk('\n\nnombre\nAna')
    expect(read.headerRow).toBe(3)
    expect(read.rows[0]?.rowNumber).toBe(4)
  })

  it('marks rows with an unclosed quote', () => {
    const read = readOk('a;b\n1;2\n"3;4\n5;6')
    expect(read.rows.some((row) => row.brokenQuotes)).toBe(true)
  })

  it('rejects an empty file', () => {
    expect(readCsv('')).toMatchObject({ ok: false, error: expect.stringContaining('vacío') })
    expect(readCsv('\n ; \n')).toMatchObject({ ok: false })
  })

  it('rejects a file with only headers', () => {
    expect(readCsv('nombre;correo\n')).toMatchObject({
      ok: false,
      error: expect.stringContaining('encabezados'),
    })
  })

  it(`accepts ${MAX_ROWS} rows and rejects one more`, () => {
    const file = (rows: number) => `n\n${'1\n'.repeat(rows)}`
    expect(readCsv(file(MAX_ROWS)).ok).toBe(true)
    const over = readCsv(file(MAX_ROWS + 1))
    expect(over).toMatchObject({ ok: false, error: expect.stringContaining('20.001 filas') })
  })
})

describe('isEmptyRecord', () => {
  it('treats blank lines and rows of empty fields as empty', () => {
    expect(isEmptyRecord([''])).toBe(true)
    expect(isEmptyRecord(['  ', '', '\t'])).toBe(true)
    expect(isEmptyRecord(['', 'x'])).toBe(false)
  })
})

describe('detectColumns', () => {
  it('normalises, de-duplicates and types the headers', () => {
    const columns = detectColumns(
      ['Nombre', 'Correo', 'Correo', ''],
      [
        ['ana', 'ana@example.com', 'a@example.com', 'x'],
        ['luis', 'luis@example.com', 'l@example.com', 'y'],
      ],
    )
    expect(columns.map((column) => column.key)).toEqual(['nombre', 'correo', 'correo_2', 'columna_4'])
    expect(columns.map((column) => column.type)).toEqual(['text', 'email', 'email', 'text'])
    expect(columns[0]?.titleCase).toBe(true)
  })
})

describe('normalizeValue', () => {
  it('turns empty cells into null', () => {
    expect(normalizeValue(textColumn('nota', 0), '   ')).toBeNull()
  })

  it('applies title case only to name and place columns', () => {
    expect(normalizeValue(textColumn('nombre', 0, true), 'ANA  GÓMEZ')).toBe('Ana Gómez')
    expect(normalizeValue(textColumn('nota', 0), 'LLAMAR  luego')).toBe('LLAMAR luego')
  })
})

describe('structuralError and normalizeRow', () => {
  const columns = [textColumn('a', 0), textColumn('b', 1)]
  const row = (fields: string[], brokenQuotes = false) => ({ rowNumber: 2, fields, brokenQuotes })

  it('accepts rows with the right number of fields, or extra empty ones', () => {
    expect(structuralError(row(['1', '2']), 2)).toBeNull()
    expect(structuralError(row(['1', '2', '', ' ']), 2)).toBeNull()
  })

  it('flags extra fields with data, missing fields and broken quotes', () => {
    expect(structuralError(row(['1', '2', '3']), 2)?.message).toContain('3 campos con datos')
    expect(structuralError(row(['1']), 2)?.message).toContain('falta un separador')
    expect(structuralError(row(['1', '2'], true), 2)?.message).toContain('comillas')
  })

  it('records which cells changed', () => {
    const processed = normalizeRow(columns, row([' x', 'y']))
    expect(processed.clean).toEqual({ a: 'x', b: 'y' })
    expect(processed.changed).toEqual(['a'])
    expect(processed.errors).toEqual([])
  })
})

describe('rowSignature', () => {
  it('matches rows whose normalised values are the same', () => {
    const columns = [textColumn('a', 0)]
    const a = normalizeRow(columns, { rowNumber: 2, fields: [' x '], brokenQuotes: false })
    const b = normalizeRow(columns, { rowNumber: 3, fields: ['x'], brokenQuotes: false })
    expect(rowSignature(columns, a)).toBe(rowSignature(columns, b))
  })
})

describe('runMigration with the sample file', () => {
  const result = migrate(SAMPLE_CSV)
  const byRow = (rows: ProcessedRow[], rowNumber: number) => rows.find((row) => row.rowNumber === rowNumber)

  it('reads 37 rows separated by semicolons', () => {
    expect(result.delimiter).toBe(';')
    expect(result.totalRows).toBe(37)
  })

  it('detects every column and its type', () => {
    expect(
      result.columns.map(({ label, key, type, titleCase }) => ({ label, key, type, titleCase })),
    ).toEqual([
      { label: 'Nombre completo', key: 'nombre_completo', type: 'text', titleCase: true },
      { label: 'Correo Electrónico', key: 'correo_electronico', type: 'email', titleCase: false },
      { label: 'Teléfono', key: 'telefono', type: 'phone', titleCase: false },
      { label: 'Fecha de registro', key: 'fecha_de_registro', type: 'date', titleCase: false },
      { label: 'Monto (COP)', key: 'monto_cop', type: 'amount', titleCase: false },
      { label: 'Ciudad', key: 'ciudad', type: 'text', titleCase: true },
    ])
  })

  it('accounts for every row: valid, with errors, duplicate or empty', () => {
    expect(result.valid).toHaveLength(20)
    expect(result.invalid).toHaveLength(11)
    expect(result.duplicates).toHaveLength(3)
    expect(result.emptyRows).toEqual([7, 12, 19])
    const accounted =
      result.valid.length + result.invalid.length + result.duplicates.length + result.emptyRows.length
    expect(accounted).toBe(result.totalRows)
  })

  it('finds duplicates only visible after normalising', () => {
    expect(result.duplicates).toEqual([
      { rowNumber: 9, duplicateOf: 2 },
      { rowNumber: 16, duplicateOf: 3 },
      { rowNumber: 23, duplicateOf: 4 },
    ])
  })

  it('normalises a messy row completely', () => {
    const row = byRow(result.valid, 2)
    expect(row?.raw).toMatchObject({ nombre_completo: '  ana maría  GÓMEZ ', telefono: '300 555 0101' })
    expect(row?.clean).toEqual({
      nombre_completo: 'Ana María Gómez',
      correo_electronico: 'ana.gomez@example.com',
      telefono: '+573005550101',
      fecha_de_registro: '2024-04-03',
      monto_cop: 1200000.5,
      ciudad: 'Bogotá',
    })
    expect(row?.changed).toHaveLength(6)
  })

  it('keeps international numbers and reads written dates and currencies', () => {
    expect(byRow(result.valid, 24)?.clean).toMatchObject({ telefono: '+14155550117', monto_cop: 1250 })
    expect(byRow(result.valid, 29)?.clean.fecha_de_registro).toBe('2025-04-09')
    expect(byRow(result.valid, 36)?.clean.fecha_de_registro).toBe('2025-07-01')
    expect(byRow(result.valid, 37)?.clean.telefono).toBe('+573005550130')
    expect(byRow(result.valid, 25)?.clean.ciudad).toBe('Bogotá D.C.')
  })

  it('keeps empty cells as null in valid rows', () => {
    expect(byRow(result.valid, 26)?.clean).toMatchObject({ fecha_de_registro: null, monto_cop: null })
  })

  it('explains each invalid row by field', () => {
    const errors = Object.fromEntries(
      result.invalid.map((row) => [row.rowNumber, row.errors.map((error) => error.key || 'fila')]),
    )
    expect(errors).toEqual({
      8: ['correo_electronico'],
      10: ['correo_electronico'],
      11: ['telefono'],
      13: ['fecha_de_registro'],
      14: ['fecha_de_registro'],
      15: ['monto_cop'],
      17: ['telefono'],
      18: ['correo_electronico'],
      27: ['monto_cop'],
      28: ['correo_electronico', 'telefono'],
      33: ['fila'],
    })
  })

  it('writes messages that say what happened and how to fix it', () => {
    const message = (rowNumber: number) => byRow(result.invalid, rowNumber)?.errors[0]?.message
    expect(message(10)).toContain('le falta la @')
    expect(message(13)).toContain('febrero de 2024 tiene 29 días')
    expect(message(14)).toContain('escríbela como 13/04/2024')
    expect(message(17)).toContain('«+57 300 555 01» tiene 8')
    expect(message(33)).toContain('sobra un separador')
  })

  it('counts the changed cells by type', () => {
    expect(result.changedCells).toBe(Object.values(result.changesByType).reduce((sum, n) => sum + n, 0))
    expect(result.changesByType.phone).toBeGreaterThan(0)
    expect(result.changesByType.date).toBeGreaterThan(0)
    expect(result.changesByType.amount).toBeGreaterThan(0)
    expect(result.changesByType.email).toBeGreaterThan(0)
    expect(result.changesByType.text).toBeGreaterThan(0)
  })

  it('picks the first row with most changes as the showcase', () => {
    expect(pickShowcaseRow(result.valid)?.rowNumber).toBe(2)
    expect(pickShowcaseRow([])).toBeUndefined()
  })
})

describe('runMigration edge cases', () => {
  it('passes errors from reading through', () => {
    expect(runMigration('')).toMatchObject({ ok: false })
  })

  it('handles a file whose data rows are all empty', () => {
    const result = migrate('nombre;correo\n;\n\n')
    expect(result.emptyRows).toEqual([2, 3])
    expect(result.valid).toEqual([])
  })

  it('does not drop invalid rows as duplicates of each other', () => {
    const result = migrate(
      'correo\nmal\nmal\nana@example.com\nluis@example.com\nsofia@example.com\npaula@example.com',
    )
    expect(result.invalid.map((row) => row.rowNumber)).toEqual([2])
    expect(result.duplicates).toEqual([{ rowNumber: 3, duplicateOf: 2 }])
  })

  it('works with comma-separated files and quoted amounts', () => {
    const result = migrate('nombre,monto\nana,"$1.200.000,50"\nluis,"1,500"')
    expect(result.delimiter).toBe(',')
    expect(result.valid.map((row) => row.clean.monto)).toEqual([1200000.5, 1500])
  })

  it('processes the maximum number of rows', () => {
    const lines = Array.from({ length: MAX_ROWS }, (_, i) => `cliente ${i};c${i}@example.com`)
    const result = migrate(`nombre;correo\n${lines.join('\n')}`)
    expect(result.valid).toHaveLength(MAX_ROWS)
  })
})
