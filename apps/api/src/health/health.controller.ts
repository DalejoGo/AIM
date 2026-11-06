import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

export interface HealthStatus {
  status: 'ok'
  uptimeSeconds: number
}

@ApiTags('health')
// Render's health checks must never get a 429.
@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({ description: 'The API is up.' })
  check(): HealthStatus {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) }
  }
}
