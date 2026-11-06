import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiTags } from '@nestjs/swagger'

export interface HealthStatus {
  status: 'ok'
  uptimeSeconds: number
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({ description: 'The API is up.' })
  check(): HealthStatus {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) }
  }
}
