import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { StoreService } from './store.service';

const TIME_RANGE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

class PublicStoreQuery {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  region?: string;

  @IsOptional()
  @IsIn(['PICKUP', 'DELIVERY'])
  capability?: 'PICKUP' | 'DELIVERY';
}

export class StoreDto {
  @IsOptional()
  @IsString()
  @Length(2, 20)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  region?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  address?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsObject()
  businessHours?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  pickupEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  deliveryEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFeeCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  freeDeliveryThresholdCents?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(TIME_RANGE, { each: true })
  deliverySlots?: string[];

  @IsOptional()
  @Matches(TIME)
  deliveryCutoff?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxOrdersPerSlot?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  pickupCompleteDays?: number;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  notice?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';

  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 60, { each: true })
  deliveryRegions?: string[];
}

@ApiTags('stores')
@Controller('stores')
export class StoreController {
  constructor(private readonly stores: StoreService) {}

  @Get()
  @ApiOperation({ summary: '启用中的门店列表（可按区域与履约能力筛选）' })
  list(@Query() query: PublicStoreQuery) {
    return this.stores.listPublic(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '门店详情（仅启用中的门店）' })
  detail(@Param('id') id: string) {
    return this.stores.detailPublic(id);
  }
}
