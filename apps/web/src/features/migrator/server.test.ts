import type { PyLabLimits } from '@aim/contracts/migrator'
import { describe, expect, it } from 'vitest'
import {
  checkServerFile,
  encodingText,
  formatText,
  isWorkbook,
  limitsText,
  pylabApiUrl,
  SERVER_TIMEOUT_MS,
  serverFailureText,
  serverWokeText,
} from './server'

const LIMITS: PyLabLimits = {
  maxUploadBytes: 10 * 1024 * 1024,
  maxRows: 50_000,
  maxColumns: 50,
  maxCells: 300_000,
  formats: ['csv', 'xls', 'xlsx'],
}

describe('pylabApiUrl', () => {
  it('keeps an absolute http(s) base without trailing slashes', () => {
    expect(pylabApiUrl(' https://aimweb-pylab.onrender.com/ ')).toBe('https://aimweb-pylab.onrender.com')
    expect(pylabApiUrl('http://localhost:8000')).toBe('http://localhost:8000')
  })

  it('turns the engine off when the variable is empty or not a URL', () => {
    expect(pylabApiUrl(undefined)).toBeNull()
    expect(pylabApiUrl('')).toBeNull()
    expect(pylabApiUrl('pylab.example.com')).toBeNull()
    expect(pylabApiUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('checkServerFile', () => {
  it('accepts CSV and Excel workbooks within the limit', () => {
    for (const name of ['clientes.csv', 'datos.TXT', 'libro.xlsx', 'macros.xlsm', 'viejo.xls']) {
      expect(checkServerFile(name, 1024, LIMITS)).toBeNull()
    }
  })

  it('names the formats it cannot read', () => {
    expect(checkServerFile('hoja.ods', 10, LIMITS)).toMatch(/guárdalo como \.xlsx o como CSV/)
    expect(checkServerFile('foto.png', 10, LIMITS)).toMatch(/Sube un archivo \.csv, \.xlsx o \.xls/)
  })

  it('refuses empty and oversized files before sending them', () => {
    expect(checkServerFile('a.csv', 0, LIMITS)).toMatch(/está vacío/)
    expect(checkServerFile('a.xlsx', 11 * 1024 * 1024, LIMITS)).toBe(
      'El archivo pesa 11 MB y el límite del servidor es 10 MB. Divídelo en partes más pequeñas o quita las columnas que no necesites.',
    )
  })

  it('lets the server judge the size while its limits are unknown', () => {
    expect(checkServerFile('a.xlsx', 50 * 1024 * 1024, null)).toBeNull()
  })
})

describe('texts', () => {
  it('states the limits once the server told them', () => {
    expect(limitsText(LIMITS)).toBe(
      'CSV o Excel (.xlsx, .xls) de hasta 10 MB, 50.000 filas y 300.000 celdas, con los nombres de las columnas en la primera fila.',
    )
    expect(limitsText(null)).toMatch(/Los límites aparecen cuando el servidor responde/)
  })

  it('names encodings and formats in plain Spanish', () => {
    expect(encodingText({ name: 'windows-1252', detectedBy: 'charset-normalizer' })).toBe(
      'Windows-1252 (Excel en español), detectada con charset-normalizer',
    )
    expect(encodingText({ name: 'utf-8', detectedBy: 'bom' })).toBe(
      'UTF-8, por la marca al inicio del archivo',
    )
    expect(formatText({ format: 'xls' })).toBe('Excel 97-2003 (.xls)')
    expect(isWorkbook({ format: 'xlsx' })).toBe(true)
    expect(isWorkbook({ format: 'csv' })).toBe(false)
  })

  it('explains a slow start and each failure', () => {
    expect(serverWokeText(41_200)).toBe(
      'El servidor estaba dormido y tardó 41,2 s en responder. Los siguientes archivos irán más rápido.',
    )
    expect(serverFailureText('timeout', true)).toContain(`${SERVER_TIMEOUT_MS / 1000} segundos`)
    expect(serverFailureText('network', true)).toMatch(/mientras el servidor despertaba/)
    expect(serverFailureText('network', false)).toMatch(/procesa el archivo en tu navegador/)
    expect(serverFailureText('invalid', false)).toMatch(/no tiene la forma esperada/)
  })
})
