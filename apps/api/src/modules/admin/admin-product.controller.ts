import {
  Body,
  Controller,
  Delete,
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
  ArrayMinSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

import { AdminProductService } from './admin-product.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../common/auth.guards';

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
  @IsString()
  mainImageKey?: string;

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
  @IsString()
  mainImageKey?: string;

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

@ApiTags('admin-products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/products')
export class AdminProductController {
  constructor(private readonly service: AdminProductService) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS', 'WMS')
  @ApiOperation({ summary: '商品列表：关键词 / 状态 / 分类筛选' })
  list(
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.service.listAdmin({ keyword, status, categoryId });
  }

  @Post()
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '新建商品（同时创建 SKU）' })
  create(@Body() dto: CreateProductDto) {
    return this.service.create(dto);
  }

  @Get(':id')
  @Roles('SUPER', 'OPS', 'CS', 'WMS')
  @ApiOperation({ summary: '商品详情（含 SKU、分类与标签）' })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Patch(':id')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '修改商品基础信息与状态' })
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/skus/:skuId')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '修改 SKU 价格 / 库存 / 状态' })
  updateSku(
    @Param('id') id: string,
    @Param('skuId') skuId: string,
    @Body() dto: UpdateSkuDto,
  ) {
    return this.service.updateSku(id, skuId, dto);
  }

  @Patch(':id/tags')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '重置商品标签绑定' })
  updateTags(@Param('id') id: string, @Body() dto: UpdateTagsDto) {
    return this.service.updateTags(id, dto.tagIds);
  }

  @Delete(':id')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '删除商品（已产生订单的只能下架）' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
