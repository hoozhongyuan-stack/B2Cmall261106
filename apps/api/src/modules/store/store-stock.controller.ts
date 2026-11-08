import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  type AuthUser,
} from '../../common/auth.guards';
import { StoreStockService } from './store-stock.service';

class StockListQueryDto {
  @IsOptional()
  @IsString()
  skuIds?: string;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}

class StockLogQueryDto {
  @IsOptional()
  @IsString()
  skuId?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}

class AdjustStockDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  safetyStock?: number;

  @IsOptional()
  @IsIn(['ON_SALE', 'OFF_SHELF'])
  status?: 'ON_SALE' | 'OFF_SHELF';
}

class BatchStockItemDto extends AdjustStockDto {
  @IsString()
  skuId!: string;
}

class BatchStockDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BatchStockItemDto)
  items!: BatchStockItemDto[];
}

const ALL_ROLES = ['SUPER', 'OPS', 'CS', 'WMS', 'STORE'] as const;

@ApiTags('admin-store-stock')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/stores')
export class StoreStockController {
  constructor(private readonly stock: StoreStockService) {}

  @Get(':storeId/skus')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: '门店可售库存列表' })
  list(
    @CurrentUser() user: AuthUser,
    @Param('storeId') storeId: string,
    @Query() query: StockListQueryDto,
  ) {
    return this.stock.list(user, storeId, query);
  }

  @Get(':storeId/sku-options')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: '可添加到门店的 SKU（按编码/商品名搜索）' })
  skuOptions(
    @CurrentUser() user: AuthUser,
    @Param('storeId') storeId: string,
    @Query() query: StockListQueryDto,
  ) {
    return this.stock.skuOptions(user, storeId, query);
  }

  @Patch(':storeId/skus/:skuId')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: '调整门店单 SKU 库存 / 安全库存 / 状态' })
  adjust(
    @CurrentUser() user: AuthUser,
    @Param('storeId') storeId: string,
    @Param('skuId') skuId: string,
    @Body() dto: AdjustStockDto,
  ) {
    return this.stock.adjust(user, storeId, skuId, dto);
  }

  @Post(':storeId/skus/batch')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: '批量设置门店库存（最多 100 个 SKU）' })
  batch(
    @CurrentUser() user: AuthUser,
    @Param('storeId') storeId: string,
    @Body() dto: BatchStockDto,
  ) {
    return this.stock.batchAdjust(user, storeId, dto.items);
  }

  @Get(':storeId/stock-logs')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: '门店库存流水（可售库存口径）' })
  logs(
    @CurrentUser() user: AuthUser,
    @Param('storeId') storeId: string,
    @Query() query: StockLogQueryDto,
  ) {
    return this.stock.logs(user, storeId, query);
  }
}
