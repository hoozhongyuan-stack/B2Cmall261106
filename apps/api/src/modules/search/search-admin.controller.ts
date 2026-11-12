import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SearchLogService } from './search-log.service';
import { JwtAuthGuard, RolesGuard, Permission } from '../../common/auth.guards';

@ApiTags('admin-search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/search')
export class SearchAdminController {
  constructor(private readonly searchLogs: SearchLogService) {}

  @Get('stats')
  @Permission('product.view')
  @ApiOperation({ summary: '搜索统计：热词 Top、无结果词 Top（日志自动聚合）' })
  stats(@Query('days') days?: string, @Query('limit') limit?: string) {
    return this.searchLogs.stats(Number(days) || 30, Number(limit) || 10);
  }
}
