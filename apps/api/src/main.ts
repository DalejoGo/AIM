import { ConsoleLogger, Logger } from '@nestjs/common'
import { createApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig(process.env)
// One JSON object per line in production, so Render's log search can filter by field.
const logger = new ConsoleLogger({ json: process.env.NODE_ENV === 'production' })

const app = await createApp({ config, logger })
await app.listen(config.port)
Logger.log(`API listening on port ${config.port} (docs at /docs)`, 'Bootstrap')
