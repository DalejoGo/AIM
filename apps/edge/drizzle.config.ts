import { defineConfig } from 'drizzle-kit'

// Migrations are generated from src/db/schema.ts and applied with DATABASE_URL (local Docker or Neon, DEC-015).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://aim:aim@127.0.0.1:54321/aim' },
  strict: true,
})
