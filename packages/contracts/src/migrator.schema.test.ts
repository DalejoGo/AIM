import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ApiError } from './api'
import { PyLabError } from './migrator'
import { migratorSchemaFiles } from './migrator-json-schema'

/**
 * The JSON Schemas in services/py-lab/contract are generated from migrator.ts. If this fails, the contract
 * changed and the files are stale: run `pnpm --filter @aim/contracts schemas:update`, then the Python checks
 * (its pytest validates every response against these files).
 */
const CONTRACT_DIR = new URL('../../../services/py-lab/contract/', import.meta.url)

describe('migrator JSON Schemas for the Python service', () => {
  for (const [file, text] of Object.entries(migratorSchemaFiles())) {
    it(`${file} is up to date`, async () => {
      await expect(text).toMatchFileSnapshot(new URL(file, CONTRACT_DIR).pathname)
    })
  }

  it('closes every object, so an extra field in a response fails validation', () => {
    for (const text of Object.values(migratorSchemaFiles())) {
      const defs = Object.values((JSON.parse(text) as { $defs: Record<string, { type?: unknown }> }).$defs)
      const objects = defs.filter((def) => def.type === 'object')
      expect(objects.length).toBeGreaterThan(0)
      for (const def of objects) expect(def).toHaveProperty('additionalProperties', false)
    }
  })

  it('keeps the error body equal to the ApiError of the other APIs', () => {
    expect(z.toJSONSchema(PyLabError)).toEqual(z.toJSONSchema(ApiError))
  })
})
