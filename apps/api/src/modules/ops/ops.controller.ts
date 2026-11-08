import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { OpsService } from './ops.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../common/auth.guards';

@ApiTags('admin-ops')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/ops')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('status')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '系统状态：磁盘、备份、通知、退款与告警' })
  status() {
    return this.ops.status();
  }
}
