/** Limits of the demo: everything runs in the visitor's browser, so files stay small. */
export const MAX_BYTES = 5 * 1024 * 1024
export const MAX_ROWS = 20_000

const count = new Intl.NumberFormat('es-CO')
const megabytes = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 })

export function formatCount(n: number): string {
  return count.format(n)
}

/** "850 bytes", "3,2 KB", "4,8 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${megabytes.format(bytes / 1024)} KB`
  return `${megabytes.format(bytes / (1024 * 1024))} MB`
}

const EXCEL = /\.(?:xlsx|xlsm|xls|ods|numbers)$/i
const TEXT = /\.(?:csv|txt)$/i

/** Checks name and size before reading. Returns what to tell the visitor, or null when the file is fine. */
export function checkFile(name: string, size: number, type = ''): string | null {
  if (EXCEL.test(name)) {
    return 'Ese archivo es una hoja de cálculo, no un CSV. Ábrelo y guárdalo como «CSV UTF-8», luego súbelo de nuevo.'
  }
  if (!TEXT.test(name) && !type.startsWith('text/')) {
    return 'Ese archivo no es un CSV. Sube un archivo .csv con los datos separados por comas o punto y coma.'
  }
  if (size === 0) {
    return 'El archivo está vacío. Sube un CSV con una fila de encabezados y al menos una fila de datos.'
  }
  if (size > MAX_BYTES) {
    return `El archivo pesa ${formatBytes(size)} y el límite es ${formatBytes(MAX_BYTES)}. Divídelo en partes más pequeñas o quita las columnas que no necesites.`
  }
  return null
}

/**
 * Decodes the file bytes. UTF-8 first; files saved by Excel in Spanish are often Windows-1252, so if the bytes
 * are not valid UTF-8 they are read that way and accents still come out right.
 */
export function decodeCsv(bytes: Uint8Array): { ok: true; text: string } | { ok: false; error: string } {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes)
  }
  if (text.includes('\u0000')) {
    return {
      ok: false,
      error: 'El archivo no es texto plano. Si viene de Excel, guárdalo como «CSV UTF-8» y súbelo de nuevo.',
    }
  }
  return { ok: true, text }
}
