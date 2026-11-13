import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

import { LoyaltyService } from './loyalty.service';
import { AssetService, type UploadedImage } from '../assets/asset.service';
import { RateLimit } from '../../common/rate-limit.guard';
import { CurrentUser, UserJwtGuard, type MiniappUser } from '../../common/user-auth.guard';
import { JwtAuthGuard, RolesGuard, Permission } from '../../common/auth.guards';

class LevelDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(0)
  thresholdCents!: number;

  @IsNumber()
  @Min(0.01)
  @Max(1)
  discountRate!: number;
}

class UpdateLevelDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  thresholdCents?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(1)
  discountRate?: number;
}

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsString()
  avatarKey?: string | null;
}

@ApiTags('member')
@ApiBearerAuth()
@UseGuards(UserJwtGuard)
@Controller('member')
export class MemberController {
  constructor(
    private readonly loyalty: LoyaltyService,
    private readonly assets: AssetService,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: '会员中心：等级、成长值、积分与券数量' })
  profile(@CurrentUser() user: MiniappUser) {
    return this.loyalty.profile(user.sub);
  }

  @Patch('profile')
  @ApiOperation({ summary: '维护个人资料：昵称与头像' })
  updateProfile(@CurrentUser() user: MiniappUser, @Body() dto: UpdateProfileDto) {
    return this.loyalty.updateProfile(user.sub, dto);
  }

  @Post('avatar')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传头像（单张图片，≤5MB，返回素材 key）' })
  async uploadAvatar(@UploadedFile() file: UploadedImage) {
    if (!file?.buffer?.length) throw new BadRequestException('请选择头像图片');
    if (!(file.mimetype ?? '').startsWith('image/')) {
      throw new BadRequestException('头像仅支持 JPG / PNG / WEBP / GIF 图片');
    }
    const result = await this.assets.upload([file]);
    return result.items[0];
  }

  @Get('points')
  @ApiOperation({ summary: '积分明细（仅记录发放与扣回，不参与抵扣）' })
  points(@CurrentUser() user: MiniappUser) {
    return this.loyalty.ledger(user.sub);
  }
}

@ApiTags('admin-member')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/member-levels')
export class AdminMemberLevelController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  @Permission('level.view')
  @ApiOperation({ summary: '等级规则列表（含各等级人数）' })
  list() {
    return this.loyalty.listLevels();
  }

  @Post()
  @Permission('level.manage')
  @ApiOperation({ summary: '新建等级规则' })
  create(@Body() dto: LevelDto) {
    return this.loyalty.createLevel(dto);
  }

  @Patch(':id')
  @Permission('level.manage')
  @ApiOperation({ summary: '修改等级门槛或折扣' })
  update(@Param('id') id: string, @Body() dto: UpdateLevelDto) {
    return this.loyalty.updateLevel(id, dto);
  }
}
