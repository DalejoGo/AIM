import { Logger } from '@nestjs/common'
import { createApp } from './app.js'

const port = Number(process.env.API_PORT ?? 3000)
const corsOrigins = (process.env.API_CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const app = await createApp({ corsOrigins })
await app.listen(port)
Logger.log(`API listening on http://localhost:${port} (docs at /docs)`, 'Bootstrap')
