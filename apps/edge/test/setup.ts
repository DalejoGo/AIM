import { afterAll } from 'vitest'
import { openDatabases } from './helpers'

// Databases created outside a single test (beforeAll) are closed when their file finishes.
afterAll(async () => {
  await Promise.all([...openDatabases].map((pg) => pg.close()))
  openDatabases.clear()
})
