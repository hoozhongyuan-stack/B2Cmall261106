import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

import { PromotionService } from './promotion.service';
import { JwtAuthGuard, RolesGuard, Permission } from '../../common/auth.guards';

class ScopeDto {
  @IsIn(['CATEGORY', 'PRODUCT'])
  targetType!: 'CATEGORY' | 'PRODUCT';

  @IsString()
  targetId!: string;
}

class SeckillSkuDto {
  @IsString()
  skuId!: string;

  @IsInt()
  @Min(1)
  seckillPriceCents!: number;

  @IsInt()
  @Min(1)
  stock!: number;

  @IsInt()
  @Min(1)
  limitPerUser!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number;
}

class PromotionDto {
  @IsOptional()
  @IsString()
  @Length(1, 30)
  name?: string;

  @IsOptional()
  @IsIn(['FULL_REDUCTION', 'SECKILL'])
  type?: 'FULL_REDUCTION' | 'SECKILL';

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  startAt?: string;

  @IsOptional()
  @IsString()
  endAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  thresholdCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  discountCents?: number;

  @IsOptional()
  @IsIn(['ALL', 'CATEGORY', 'PRODUCT'])
  scopeType?: 'ALL' | 'CATEGORY' | 'PRODUCT';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScopeDto)
  scopes?: ScopeDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeckillSkuDto)
  skus?: SeckillSkuDto[];
}

@ApiTags('promotions')
@Controller('promotions')
export class PromotionPublicController {
  constructor(private readonly promotions: PromotionService) {}

  @Get('seckill')
  @ApiOperation({ summary: '进行中的秒杀商品' })
  seckill() {
    return this.promotions.activeSeckills();
  }
}

@ApiTags('admin-promotions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/promotions')
export class AdminPromotionController {
  constructor(private readonly promotions: PromotionService) {}

  @Get()
  @Permission('promotion.view')
  @ApiOperation({ summary: '满减与秒杀活动列表' })
  list() {
    return this.promotions.adminList();
  }

  @Post()
  @Permission('promotion.manage')
  @ApiOperation({ summary: '新建满减或秒杀活动' })
  create(@Body() dto: PromotionDto) {
    return this.promotions.create(dto);
  }

  @Patch(':id')
  @Permission('promotion.manage')
  @ApiOperation({ summary: '修改活动（启停 / 时间 / 范围 / 商品）' })
  update(@Param('id') id: string, @Body() dto: PromotionDto) {
    return this.promotions.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @Permission('promotion.manage')
  @ApiOperation({ summary: '删除活动' })
  remove(@Param('id') id: string) {
    return this.promotions.remove(id);
  }
}
