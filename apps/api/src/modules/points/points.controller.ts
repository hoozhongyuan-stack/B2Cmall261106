import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { PointsService } from './points.service';
import { CurrentUser, UserJwtGuard, type MiniappUser } from '../../common/user-auth.guard';
import { JwtAuthGuard, RolesGuard, Permission } from '../../common/auth.guards';

class UpdatePointsConfigDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  yuanPerPoint?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  signInPoints?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  signInStreakDays?: number;

  @IsOptional()
  @IsIn(['POINTS', 'COUPON'])
  signInStreakBonusType?: 'POINTS' | 'COUPON';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  signInStreakBonusPoints?: number;

  @IsOptional()
  @IsString()
  signInStreakCouponId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sharePoints?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  shareDailyLimit?: number;
}

@ApiTags('points')
@ApiBearerAuth()
@UseGuards(UserJwtGuard)
@Controller('member/points')
export class PointsController {
  constructor(private readonly points: PointsService) {}

  @Get('overview')
  @ApiOperation({ summary: '积分概览：规则、签到状态与分享进度' })
  overview(@CurrentUser() user: MiniappUser) {
    return this.points.overview(user.sub);
  }

  @Post('sign-in')
  @HttpCode(200)
  @ApiOperation({ summary: '每日签到（连续签到按规则奖励积分或优惠券）' })
  signIn(@CurrentUser() user: MiniappUser) {
    return this.points.signIn(user.sub);
  }

  @Post('share')
  @HttpCode(200)
  @ApiOperation({ summary: '分享奖励（按每日次数上限发放积分）' })
  share(@CurrentUser() user: MiniappUser) {
    return this.points.share(user.sub);
  }
}

@ApiTags('admin-points')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/points-config')
export class AdminPointsConfigController {
  constructor(private readonly points: PointsService) {}

  @Get()
  @Permission('points.view')
  @ApiOperation({ summary: '积分规则配置' })
  detail() {
    return this.points.config();
  }

  @Put()
  @Permission('points.manage')
  @ApiOperation({ summary: '保存积分规则配置' })
  save(@Body() dto: UpdatePointsConfigDto) {
    return this.points.updateConfig(dto);
  }
}
