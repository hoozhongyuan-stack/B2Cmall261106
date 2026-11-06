import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

import { MiniappReleaseService } from './miniapp-release.service';
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard, type AuthUser } from '../../common/auth.guards';
import { RateLimit } from '../../common/rate-limit.guard';

class CreateReleaseDto {
  @IsString()
  @Length(1, 20)
  version!: string;

  @IsString()
  @Length(1, 200)
  description!: string;
}

@ApiTags('admin-miniapp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/miniapp')
export class AdminMiniappReleaseController {
  constructor(private readonly service: MiniappReleaseService) {}

  @Get('readiness')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '发布环境检查：AppID / 上传密钥 / API 地址 / 建议版本号' })
  readiness() {
    return this.service.readiness();
  }

  @Get('releases')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '发布记录（最近 20 条）' })
  list() {
    return this.service.list();
  }

  @Get('releases/:id')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '发布记录详情（含构建日志）' })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Post('releases')
  @HttpCode(202)
  @Roles('SUPER')
  @RateLimit({ limit: 3, windowMs: 60_000 })
  @ApiOperation({ summary: '构建并上传开发版（异步，约 1-2 分钟）' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReleaseDto) {
    return this.service.create(user, dto.version, dto.description);
  }

  @Get('releases/:id/qrcode')
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '体验版二维码（base64 data URL）' })
  qrcode(@Param('id') id: string) {
    return this.service.qrcode(id);
  }

  @Post('releases/:id/released')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '标记为已发布（审核与发布在微信后台完成）' })
  markReleased(@Param('id') id: string) {
    return this.service.markReleased(id);
  }
}
