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
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Length } from 'class-validator';

import { PopupAdService } from './popup-ad.service';
import { JwtAuthGuard, RolesGuard, Permission } from '../../common/auth.guards';

class SavePopupAdDto {
  @IsString()
  @Length(1, 20)
  name!: string;

  @IsString()
  @Length(1, 300)
  imageKey!: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  alt?: string | null;

  @IsOptional()
  @IsObject()
  link?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  startAt?: string | null;

  @IsOptional()
  @IsString()
  endAt?: string | null;
}

class TogglePopupAdDto {
  @IsBoolean()
  enabled!: boolean;
}

@ApiTags('popup-ad')
@Controller('popup-ad')
export class PopupAdController {
  constructor(private readonly popupAds: PopupAdService) {}

  @Get('active')
  @ApiOperation({ summary: '首页弹窗广告：当前可展示列表（按优先级）+ 服务端日期' })
  active() {
    return this.popupAds.active();
  }
}

@ApiTags('admin-popup-ad')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/popup-ads')
export class AdminPopupAdController {
  constructor(private readonly popupAds: PopupAdService) {}

  @Get()
  @Permission('popupad.view')
  @ApiOperation({ summary: '弹窗广告列表' })
  list(
    @Query('keyword') keyword?: string,
    @Query('enabled') enabled?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.popupAds.list({
      keyword,
      enabled,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  }

  @Post()
  @Permission('popupad.manage')
  @ApiOperation({ summary: '新建弹窗广告' })
  create(@Body() dto: SavePopupAdDto) {
    return this.popupAds.create(dto);
  }

  @Get(':id')
  @Permission('popupad.view')
  @ApiOperation({ summary: '弹窗广告详情' })
  detail(@Param('id') id: string) {
    return this.popupAds.detail(id);
  }

  @Put(':id')
  @Permission('popupad.manage')
  @ApiOperation({ summary: '保存弹窗广告' })
  update(@Param('id') id: string, @Body() dto: SavePopupAdDto) {
    return this.popupAds.update(id, dto);
  }

  @Patch(':id/enabled')
  @Permission('popupad.manage')
  @ApiOperation({ summary: '启用 / 停用弹窗广告' })
  toggle(@Param('id') id: string, @Body() dto: TogglePopupAdDto) {
    return this.popupAds.setEnabled(id, dto.enabled);
  }

  @Delete(':id')
  @HttpCode(200)
  @Permission('popupad.manage')
  @ApiOperation({ summary: '删除弹窗广告（软删除）' })
  remove(@Param('id') id: string) {
    return this.popupAds.remove(id);
  }
}
