import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { SearchLogService } from './search-log.service';

@ApiTags('search')
@Controller('search')
export class SearchPublicController {
  constructor(private readonly searchLogs: SearchLogService) {}

  @Get('hot')
  @ApiOperation({ summary: '搜索热词（日志自动聚合，近 30 天）' })
  hot(@Query('limit') limit?: string) {
    return this.searchLogs.hotKeywords(Number(limit) || 10);
  }
}
