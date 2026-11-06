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

  @IsOptional()
  @IsString()
  miniappAppId?: string;
}

class CreateRegionDto {
  @IsString()
  regionName!: string;

  @IsInt()
  freightCents!: number;
}

class CreateAssetDto {
  @IsString()
  key!: string;

  @IsString()
  url!: string;

  @IsOptional()
  @IsInt()
  size?: number;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsString()
  group?: string;
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

@ApiTags('admin-assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/assets')
export class AdminAssetController {
  constructor(private readonly service: ShopService) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS', 'WMS')
  @ApiOperation({ summary: '素材列表' })
  list(@Query('group') group?: string, @Query('keyword') keyword?: string) {
    return this.service.listAssets({ group, keyword });
  }

  @Post()
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '登记素材' })
  create(@Body() dto: CreateAssetDto) {
    return this.service.createAsset(dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '删除素材（被引用时不可删）' })
  remove(@Param('id') id: string) {
    return this.service.removeAsset(id);
  }
}
