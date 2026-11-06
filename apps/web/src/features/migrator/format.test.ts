import { describe, expect, it } from 'vitest'
import {
  cellText,
  changeLines,
  delimiterName,
  plural,
  reasonText,
  SAMPLE_NOTE,
  summarySentence,
  typeLabel,
} from './format'
import { runMigration } from './pipeline'
import { SAMPLE_CSV } from './sample'
import type { Column } from './types'

const column = (overrides: Partial<Column>): Column => ({
  index: 0,
  label: 'x',
  key: 'x',
  type: 'text',
  titleCase: false,
  reason: 'default',
  sampled: 10,
  matched: 10,
  ...overrides,
})

const sample = (() => {
  const outcome = runMigration(SAMPLE_CSV)
  if (!outcome.ok) throw new Error(outcome.error)
  return outcome.result
})()

describe('typeLabel', () => {
  it('names each type in Spanish', () => {
    expect(typeLabel(column({ type: 'email' }))).toBe('Correo')
    expect(typeLabel(column({ type: 'phone' }))).toBe('Teléfono')
    expect(typeLabel(column({ type: 'text', titleCase: true }))).toBe('Texto en formato título')
  })
})

describe('reasonText', () => {
  it('explains each kind of decision', () => {
    expect(reasonText(column({ type: 'email', reason: 'header', matched: 33, sampled: 34 }))).toBe(
      'El encabezado lo sugiere y 33 de 34 valores lo confirman.',
    )
    expect(reasonText(column({ type: 'date', reason: 'values', matched: 9 }))).toBe(
      '9 de 10 valores tienen forma de fecha.',
    )
    expect(reasonText(column({ reason: 'identifier' }))).toContain('identificador')
    expect(reasonText(column({ reason: 'default', sampled: 0 }))).toBe('La columna está vacía.')
    expect(reasonText(column({ reason: 'default', titleCase: true }))).toContain('formato título')
    expect(reasonText(column({ reason: 'default' }))).toBe('Ningún otro tipo llegó al 80 % de los valores.')
  })
})

describe('small helpers', () => {
  it('names the separator', () => {
    expect(delimiterName(';')).toBe('punto y coma')
    expect(delimiterName(',')).toBe('comas')
  })

  it('shows empty cells as empty text and numbers as written in the export', () => {
    expect(cellText(null)).toBe('')
    expect(cellText(1200000.5)).toBe('1200000.5')
  })

  it('picks singular or plural and groups thousands', () => {
    expect(plural(1, 'fila', 'filas')).toBe('1 fila')
    expect(plural(20000, 'fila', 'filas')).toBe('20.000 filas')
  })

  it('mentions the sample size', () => {
    expect(SAMPLE_NOTE).toBe('hasta 200 valores por columna')
  })
})

describe('changeLines', () => {
  it('lists the types that changed, largest first', () => {
    const lines = changeLines(sample)
    expect(lines.length).toBe(5)
    expect(lines.map((line) => line.count)).toEqual(
      [...lines.map((line) => line.count)].sort((a, b) => b - a),
    )
    expect(lines.reduce((sum, line) => sum + line.count, 0)).toBe(sample.changedCells)
  })
})

describe('summarySentence', () => {
  it('accounts for every row of the sample', () => {
    expect(summarySentence(sample)).toBe(
      '37 filas leídas: 20 válidas, 11 con errores, 3 duplicadas y 3 vacías.',
    )
  })
})
