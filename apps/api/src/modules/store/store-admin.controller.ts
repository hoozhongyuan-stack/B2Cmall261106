import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

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
}

const ALL_ROLES = ['SUPER', 'OPS', 'CS', 'WMS', 'STORE'] as const;

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
  @ApiOperation({ summary: '门店列表（总部全量，门店账号仅授权门店）' })
  list(@CurrentUser() user: AuthUser, @Query() query: AdminStoreQuery) {
    return this.stores.listAdmin(user, query.status);
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

  @Delete(':id')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '停用门店（保留历史订单归属）' })
  disable(@Param('id') id: string) {
    return this.stores.disable(id);
  }
}
