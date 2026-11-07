import type { MigrationSource, PyLabLimits, SourceEncoding } from '@aim/contracts/migrator'
import { playgroundApiUrl } from '../api-playground/config'
import { formatDuration } from '../api-playground/response'
import { REQUEST_TIMEOUT_MS } from '../api-playground/wake'
import { formatBytes, formatCount } from './file'

/**
 * The Python engine (services/py-lab, FastAPI on Render) seen from the page: where it is, what it accepts and
 * how its states read. Pure and without Zod, so the page can show the choice before any of it loads; the
 * network code is in ./serverClient, loaded with the first request.
 */

export type Engine = 'browser' | 'server'

/** Base URL from PUBLIC_PYLAB_API_URL (build time), or null: then the page offers only the browser engine. */
export const pylabApiUrl = (raw: string | undefined | null): string | null => playgroundApiUrl(raw)

/** What the file picker offers in server mode; the server decides by content, not by name. */
export const SERVER_ACCEPT = [
  '.csv',
  '.txt',
  '.xlsx',
  '.xlsm',
  '.xls',
  'text/csv',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
].join(',')

const ACCEPTED = /\.(?:csv|txt|xlsx|xlsm|xls)$/i
const OTHER_SPREADSHEETS = /\.(?:ods|numbers|xlsb)$/i

/** A cold start plus a large file on 0.1 CPU: more than the API Playground's wait. */
export const SERVER_TIMEOUT_MS = 120_000

/** Checks name and size before sending. Returns what to tell the visitor, or null when the file can go. */
export function checkServerFile(name: string, size: number, limits: PyLabLimits | null): string | null {
  if (OTHER_SPREADSHEETS.test(name)) {
    return 'Ese formato de hoja de cálculo no se puede leer aquí. Ábrelo y guárdalo como .xlsx o como CSV, y súbelo de nuevo.'
  }
  if (!ACCEPTED.test(name)) {
    return 'Sube un archivo .csv, .xlsx o .xls. Si viene de otro programa, ábrelo y guárdalo en uno de esos formatos.'
  }
  if (size === 0) {
    return 'El archivo está vacío. Sube uno con una fila de encabezados y al menos una fila de datos.'
  }
  if (limits && size > limits.maxUploadBytes) {
    return `El archivo pesa ${formatBytes(size)} y el límite del servidor es ${formatBytes(limits.maxUploadBytes)}. Divídelo en partes más pequeñas o quita las columnas que no necesites.`
  }
  return null
}

/** The limits as a sentence for the drop zone. */
export function limitsText(limits: PyLabLimits | null): string {
  if (!limits) {
    return 'CSV o Excel (.xlsx, .xls), con los nombres de las columnas en la primera fila. Los límites aparecen cuando el servidor responde.'
  }
  return `CSV o Excel (.xlsx, .xls) de hasta ${formatBytes(limits.maxUploadBytes)}, ${formatCount(limits.maxRows)} filas y ${formatCount(limits.maxCells)} celdas, con los nombres de las columnas en la primera fila.`
}

const ENCODINGS: Record<SourceEncoding['name'], string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 (little endian)',
  'utf-16be': 'UTF-16 (big endian)',
  'windows-1252': 'Windows-1252 (Excel en español)',
  ibm850: 'IBM 850 (sistemas de DOS)',
  macintosh: 'Mac Roman',
}

const DETECTED_BY: Record<SourceEncoding['detectedBy'], string> = {
  bom: 'por la marca al inicio del archivo',
  'utf-8': 'porque el texto es UTF-8 válido',
  'charset-normalizer': 'detectada con charset-normalizer',
  fallback: 'la más probable para archivos en español',
}

export function encodingText(encoding: SourceEncoding): string {
  return `${ENCODINGS[encoding.name]}, ${DETECTED_BY[encoding.detectedBy]}`
}

export function formatText(source: Pick<MigrationSource, 'format'>): string {
  switch (source.format) {
    case 'csv':
      return 'CSV (texto)'
    case 'xlsx':
      return 'Excel (.xlsx)'
    case 'xls':
      return 'Excel 97-2003 (.xls)'
  }
}

export const isWorkbook = (source: Pick<MigrationSource, 'format'>): boolean => source.format !== 'csv'

/** Shown, and read once by screen readers, when the wait goes past a few seconds on a server that may sleep. */
export const SERVER_WAKING_TEXT =
  'El servidor de Python está despertando (plan gratuito de Render); puede tardar hasta un minuto.'

export function serverWokeText(totalMs: number): string {
  return `El servidor estaba dormido y tardó ${formatDuration(totalMs)} en responder. Los siguientes archivos irán más rápido.`
}

export function serverFailureText(kind: 'timeout' | 'network' | 'invalid', waking: boolean): string {
  if (kind === 'timeout') {
    return `El servidor no respondió en ${Math.round(SERVER_TIMEOUT_MS / 1000)} segundos. Puede que siga despertando o que el archivo sea muy grande: vuelve a intentarlo.`
  }
  if (kind === 'invalid') {
    return 'La respuesta del servidor no tiene la forma esperada. Vuelve a intentarlo; si sigue pasando, procesa el archivo en tu navegador.'
  }
  return waking
    ? 'Se cortó la conexión mientras el servidor despertaba. Vuelve a intentarlo en unos segundos.'
    : 'No pudimos conectar con el servidor. Revisa tu conexión y vuelve a intentarlo, o procesa el archivo en tu navegador.'
}

/** Health checks give up sooner than uploads: they only wake the server. */
export const HEALTH_TIMEOUT_MS = REQUEST_TIMEOUT_MS
