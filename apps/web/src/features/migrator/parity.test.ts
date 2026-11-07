import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { decodeCsv } from './file'
import { runMigration } from './pipeline'
import { SAMPLE_CSV } from './sample'

/**
 * Parity with the Python engine (services/py-lab). The browser pipeline runs on every CSV in
 * services/py-lab/tests/parity/inputs and its outcome is kept in expected/<name>.json; pytest
 * (tests/test_parity.py) checks that the FastAPI service returns exactly the same.
 *
 * If a rule changes here, this test fails until the expected files are written again:
 *   pnpm --filter @aim/web parity:update
 * and then pytest fails until the Python port follows. Neither engine can drift alone.
 */

/**
 * Node 22 decodes windows-1252 as Latin-1, leaving C1 control characters where browsers (WHATWG Encoding
 * Standard) put € ’ “ and the rest. The fixtures must hold what a browser produces, so the decoder that
 * decodeCsv builds gets the WHATWG table for bytes 0x80 to 0x9F. Where Node is already right, this does nothing.
 */
const WINDOWS_1252_C1 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ'
class BrowserTextDecoder extends TextDecoder {
  override decode(input?: AllowSharedBufferSource, options?: TextDecodeOptions): string {
    const text = super.decode(input, options)
    if (this.encoding !== 'windows-1252') return text
    return text.replace(/[\u0080-\u009f]/g, (char) => WINDOWS_1252_C1[char.charCodeAt(0) - 0x80] ?? char)
  }
}
vi.stubGlobal('TextDecoder', BrowserTextDecoder)

const PARITY = new URL('../../../../../services/py-lab/tests/parity/', import.meta.url)
const path = (relative: string) => fileURLToPath(new URL(relative, PARITY))

describe('parity fixtures for the Python engine', () => {
  it('keeps the sample file as an input', async () => {
    await expect(SAMPLE_CSV).toMatchFileSnapshot(path('inputs/clientes-ejemplo.csv'))
  })

  const inputs = readdirSync(path('inputs'))
    .filter((name) => name.endsWith('.csv'))
    .sort()

  it('has inputs to compare', () => {
    expect(inputs.length).toBeGreaterThan(5)
  })

  it('decodes windows-1252 as a browser does', () => {
    const decoded = decodeCsv(new Uint8Array([0x80, 0x20, 0x92, 0xe9]))
    expect(decoded).toEqual({ ok: true, text: '€ ’é' })
  })

  for (const name of inputs) {
    it(`${name}: the browser outcome is the committed one`, async () => {
      const decoded = decodeCsv(new Uint8Array(readFileSync(path(`inputs/${name}`))))
      const outcome = decoded.ok ? runMigration(decoded.text) : { ok: false, error: decoded.error }
      await expect(`${JSON.stringify(outcome, null, 2)}\n`).toMatchFileSnapshot(
        path(`expected/${name.replace(/\.csv$/, '.json')}`),
      )
    })
  }
})
