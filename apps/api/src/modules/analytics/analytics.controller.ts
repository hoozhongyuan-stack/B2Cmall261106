import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../common/auth.guards';

@ApiTags('admin-analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @Roles('SUPER', 'OPS', 'CS')
  @ApiOperation({ summary: '经营看板：活动效果、会员贡献、复购与商品排行' })
  overview(@Query('days') days?: string) {
    return this.analytics.overview(Number(days) || 30);
  }
}
