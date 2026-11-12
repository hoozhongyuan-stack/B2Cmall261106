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
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

import { AdminProductService } from './admin-product.service';
import { JwtAuthGuard, RolesGuard, Permission } from '../../common/auth.guards';

class CreateSkuDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsObject()
  specJson!: Record<string, string>;

  @IsInt()
  priceCents!: number;

  @IsOptional()
  @IsInt()
  originCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  pointsCost?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  pointsMoneyCents?: number;

  @IsInt()
  stock!: number;

  @IsOptional()
  @IsString()
  status?: string;
}

class CreateProductDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  subtitle?: string;

  @IsString()
  categoryId!: string;

  @IsOptional()
  @IsIn(['NORMAL', 'POINTS'])
  channel?: 'NORMAL' | 'POINTS';

  @IsOptional()
  @IsInt()
  @Min(0)
  pointsLimitPerUser?: number;

  /** 兼容旧字段：单张主图，等价于 mainImageKeys[0] */
  @IsOptional()
  @IsString()
  mainImageKey?: string;

  /** 主图轮播（有序，第一张为列表主图） */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mainImageKeys?: string[];

  /** 详情图片（有序，详情页上下排列） */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  detailImageKeys?: string[];

  @IsOptional()
  @IsString()
  detail?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsInt()
  sort?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSkuDto)
  skus!: CreateSkuDto[];
}

class UpdateProductDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  subtitle?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  pointsLimitPerUser?: number;

  @IsOptional()
  @IsString()
  mainImageKey?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mainImageKeys?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  detailImageKeys?: string[];

  @IsOptional()
  @IsString()
  detail?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsInt()
  sort?: number;
}

class UpdateSkuDto {
  @IsOptional()
  @IsInt()
  priceCents?: number;

  @IsOptional()
  @IsInt()
  originCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  pointsCost?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  pointsMoneyCents?: number;

  @IsOptional()
  @IsInt()
  stock?: number;

  @IsOptional()
  @IsString()
  status?: string;
}

class UpdateTagsDto {
  @IsArray()
  @IsString({ each: true })
  tagIds!: string[];
}

class BatchStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];

  @IsIn(['ON_SALE', 'OFF_SHELF'])
  status!: 'ON_SALE' | 'OFF_SHELF';
}

class BatchIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];
}

@ApiTags('admin-products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/products')
export class AdminProductController {
  constructor(private readonly service: AdminProductService) {}

  @Get()
  @Permission('product.view')
  @ApiOperation({ summary: '商品列表：关键词 / 状态 / 分类 / 价格区间筛选，支持排序与分页' })
  list(
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
    @Query('categoryId') categoryId?: string,
    @Query('channel') channel?: string,
    @Query('minPriceCents') minPriceCents?: string,
    @Query('maxPriceCents') maxPriceCents?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listAdmin({
      keyword,
      status,
      categoryId,
      channel,
      minPriceCents: minPriceCents === undefined ? undefined : Number(minPriceCents),
      maxPriceCents: maxPriceCents === undefined ? undefined : Number(maxPriceCents),
      sort,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    });
  }

  @Post()
  @Permission('product.edit')
  @ApiOperation({ summary: '新建商品（同时创建 SKU）' })
  create(@Body() dto: CreateProductDto) {
    return this.service.create(dto);
  }

  @Patch('batch/status')
  @Permission('product.edit')
  @ApiOperation({ summary: '批量上架 / 下架' })
  batchStatus(@Body() dto: BatchStatusDto) {
    return this.service.batchStatus(dto.ids, dto.status);
  }

  @Post('batch/delete')
  @HttpCode(200)
  @Permission('product.edit')
  @ApiOperation({ summary: '批量删除商品（有订单的逐条失败并返回原因）' })
  batchRemove(@Body() dto: BatchIdsDto) {
    return this.service.batchRemove(dto.ids);
  }

  @Get(':id')
  @Permission('product.view')
  @ApiOperation({ summary: '商品详情（含 SKU、分类与标签）' })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Patch(':id')
  @Permission('product.edit')
  @ApiOperation({ summary: '修改商品基础信息与状态' })
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/skus/:skuId')
  @Permission('product.stock')
  @ApiOperation({ summary: '修改 SKU 价格 / 库存 / 状态' })
  updateSku(
    @Param('id') id: string,
    @Param('skuId') skuId: string,
    @Body() dto: UpdateSkuDto,
  ) {
    return this.service.updateSku(id, skuId, dto);
  }

  @Patch(':id/tags')
  @Permission('product.edit')
  @ApiOperation({ summary: '重置商品标签绑定' })
  updateTags(@Param('id') id: string, @Body() dto: UpdateTagsDto) {
    return this.service.updateTags(id, dto.tagIds);
  }

  @Delete(':id')
  @Permission('product.edit')
  @ApiOperation({ summary: '删除商品（已产生订单的只能下架）' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
