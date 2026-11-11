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
import { IsInt, IsOptional, IsString } from 'class-validator';

import { ShopService } from './shop.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../../common/auth.guards';

class UpdateShopDto {
  @IsOptional()
  @IsString()
  shopName?: string;

  @IsOptional()
  @IsString()
  intro?: string;

  @IsOptional()
  @IsString()
  servicePhone?: string;

  @IsOptional()
  @IsString()
  logoKey?: string;

  @IsOptional()
  @IsString()
  serviceEmail?: string | null;

  @IsOptional()
  @IsString()
  serviceWechat?: string | null;

  @IsOptional()
  @IsString()
  serviceHours?: string | null;

  @IsOptional()
  @IsString()
  companyAddress?: string | null;

  @IsOptional()
  @IsString()
  companyName?: string | null;

  @IsOptional()
  @IsString()
  creditCode?: string | null;

  @IsOptional()
  @IsString()
  icpNumber?: string | null;

  @IsOptional()
  @IsString()
  icpUrl?: string | null;

  @IsOptional()
  @IsString()
  policeNumber?: string | null;

  @IsOptional()
  @IsString()
  policeUrl?: string | null;

  @IsOptional()
  @IsString()
  officialSiteUrl?: string | null;

  @IsOptional()
  @IsInt()
  freeThresholdCents?: number;

  @IsOptional()
  @IsInt()
  flatFreightCents?: number;

  @IsOptional()
  @IsInt()
  payTimeoutMinutes?: number;

  @IsOptional()
  @IsInt()
  afterSaleDays?: number;

  @IsOptional()
  @IsInt()
  autoConfirmDays?: number;
}

class CreateRegionDto {
  @IsString()
  regionName!: string;

  @IsInt()
  freightCents!: number;
}

@ApiTags('admin-shop')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/shop')
export class AdminShopController {
  constructor(private readonly service: ShopService) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS', 'WMS')
  @ApiOperation({ summary: '店铺设置（含偏远地区运费）' })
  detail() {
    return this.service.detail();
  }

  @Patch()
  @Roles('SUPER')
  @ApiOperation({ summary: '修改店铺设置' })
  update(@Body() dto: UpdateShopDto) {
    return this.service.update(dto);
  }

  @Post('regions')
  @Roles('SUPER')
  @ApiOperation({ summary: '新增偏远地区运费' })
  createRegion(@Body() dto: CreateRegionDto) {
    return this.service.createRegion(dto);
  }

  @Delete('regions/:id')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '删除偏远地区运费' })
  removeRegion(@Param('id') id: string) {
    return this.service.removeRegion(id);
  }
}
