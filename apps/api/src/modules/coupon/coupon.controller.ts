import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

import { CouponService } from './coupon.service';
import { CurrentUser, UserJwtGuard, type MiniappUser } from '../../common/user-auth.guard';
import { JwtAuthGuard, Roles, RolesGuard } from '../../common/auth.guards';

class CreateCouponDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  thresholdCents?: number;

  @IsInt()
  @Min(1)
  faceValueCents!: number;

  @IsInt()
  @Min(1)
  total!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  perLimit?: number;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;
}

class GrantCouponDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Type(() => String)
  userIds?: string[];

  @IsOptional()
  @IsBoolean()
  all?: boolean;
}

@ApiTags('coupons')
@ApiBearerAuth()
@UseGuards(UserJwtGuard)
@Controller('coupons')
export class CouponController {
  constructor(private readonly coupons: CouponService) {}

  @Get()
  @ApiOperation({ summary: '领券中心：可领取的优惠券' })
  listClaimable(@CurrentUser() user: MiniappUser) {
    return this.coupons.listClaimable(user.sub);
  }

  @Get('mine')
  @ApiOperation({ summary: '我的优惠券（未使用 / 已使用 / 已过期）' })
  listMine(
    @CurrentUser() user: MiniappUser,
    @Query('status') status?: 'UNUSED' | 'USED' | 'EXPIRED',
  ) {
    return this.coupons.listMine(user.sub, status);
  }

  @Post(':id/claim')
  @HttpCode(200)
  @ApiOperation({ summary: '领取优惠券（每人限领、总量控制）' })
  claim(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.coupons.claim(user.sub, id);
  }
}

@ApiTags('admin-coupons')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/coupons')
export class AdminCouponController {
  constructor(private readonly coupons: CouponService) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS')
  @ApiOperation({ summary: '优惠券列表（含领取数，分页，可关键词 / 类型 / 状态筛选）' })
  list(
    @Query('enabled') enabled?: string,
    @Query('keyword') keyword?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.coupons.listAdmin({
      enabled,
      keyword,
      type,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    });
  }

  @Post()
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '新建优惠券：满减 / 无门槛' })
  create(@Body() dto: CreateCouponDto) {
    return this.coupons.createAdmin(dto);
  }

  @Post(':id/toggle')
  @HttpCode(200)
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '启用 / 停用优惠券' })
  toggle(@Param('id') id: string) {
    return this.coupons.toggleAdmin(id);
  }

  @Post(':id/grant')
  @HttpCode(200)
  @Roles('SUPER', 'OPS')
  @ApiOperation({ summary: '后台发放：指定客户或全部客户' })
  grant(@Param('id') id: string, @Body() dto: GrantCouponDto) {
    return this.coupons.grantAdmin(id, dto);
  }

  @Get(':id/claims')
  @Roles('SUPER', 'OPS', 'CS')
  @ApiOperation({ summary: '发放记录' })
  claims(@Param('id') id: string) {
    return this.coupons.claimsAdmin(id);
  }
}
