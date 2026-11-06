import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { OperationLogService } from './operation-log.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../common/auth.guards';

class ListLogQueryDto {
  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  targetType?: string;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

@ApiTags('admin-logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/logs')
export class AdminLogController {
  constructor(private readonly logs: OperationLogService) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS')
  @ApiOperation({ summary: '操作日志：按操作人、模块、关键词与时间筛选' })
  list(@Query() query: ListLogQueryDto) {
    return this.logs.list(query);
  }
}
