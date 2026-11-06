import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminDashboardService } from './admin-dashboard.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../common/auth.guards';

@ApiTags('admin-dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS', 'WMS')
  @ApiOperation({ summary: '数据概览：今日指标、待办、7 日趋势与热销商品' })
  overview() {
    return this.dashboard.overview();
  }
}
