import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString } from 'class-validator';

import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  type AuthUser,
} from '../../common/auth.guards';
import { StoreDto } from './store.controller';
import { StoreService } from './store.service';

class AdminStoreQuery {
  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsIn(['PICKUP', 'DELIVERY'])
  capability?: 'PICKUP' | 'DELIVERY';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  pageSize?: number;
}

class BatchStoreStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];

  @IsIn(['ACTIVE', 'DISABLED'])
  status!: 'ACTIVE' | 'DISABLED';
}

const ALL_ROLES = ['SUPER', 'OPS', 'CS', 'WMS'] as const;

class BindManagerDto {
  /** 会员 id；传 null 表示解绑 */
  @IsOptional()
  @IsString()
  managerUserId?: string | null;
}

@ApiTags('admin-stores')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/stores')
export class StoreAdminController {
  constructor(private readonly stores: StoreService) {}

  @Get('mine')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: '当前账号可访问的门店（门店切换器）' })
  mine(@CurrentUser() user: AuthUser) {
    return this.stores.mine(user);
  }

  @Get()
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: '门店列表（总部全量，门店账号仅授权门店；支持筛选与分页）' })
  list(@CurrentUser() user: AuthUser, @Query() query: AdminStoreQuery) {
    return this.stores.listAdmin(user, query);
  }

  @Post('batch/status')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '批量启用 / 停用门店' })
  batchStatus(@Body() dto: BatchStoreStatusDto) {
    return this.stores.batchStatus(dto.ids, dto.status);
  }

  @Get(':id/dashboard')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: '门店看板 v1：今日经营、待履约与库存预警' })
  dashboard(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.stores.dashboard(user, id);
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: '门店详情（门店账号仅授权门店）' })
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.stores.detailAdmin(user, id);
  }

  @Post()
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '新增门店' })
  create(@Body() dto: StoreDto) {
    return this.stores.create(dto);
  }

  @Patch(':id')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '修改门店配置、配送范围与履约能力' })
  update(@Param('id') id: string, @Body() dto: StoreDto) {
    return this.stores.update(id, dto);
  }

  @Put(':id/manager')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '更换 / 解绑门店负责人（小程序会员）' })
  bindManager(@Param('id') id: string, @Body() dto: BindManagerDto) {
    return this.stores.bindManager(id, dto.managerUserId ?? null);
  }

  @Delete(':id')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '停用门店（保留历史订单归属）' })
  disable(@Param('id') id: string) {
    return this.stores.disable(id);
  }
}
