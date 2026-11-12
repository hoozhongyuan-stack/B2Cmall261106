import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

import { MemberCommerceService } from './member-commerce.service';
import { JwtAuthGuard, RolesGuard, Permission } from '../../common/auth.guards';
import { CurrentUser, UserJwtGuard, type MiniappUser } from '../../common/user-auth.guard';

class PlanIdDto {
  @IsString()
  @Length(1, 64)
  planId!: string;
}

class CardPlanDto {
  @IsOptional()
  @IsString()
  @Length(1, 20)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  priceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number;

  @IsOptional()
  @IsNumber()
  discountRate?: number;

  @IsOptional()
  @IsNumber()
  pointsRate?: number;

  @IsOptional()
  @IsBoolean()
  freeShipping?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number;
}

class RechargePlanDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  amountCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bonusCents?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number;
}

class AdjustBalanceDto {
  @IsString()
  @Length(1, 64)
  userId!: string;

  @IsInt()
  deltaCents!: number;

  @IsString()
  @Length(1, 100)
  reason!: string;
}

/* ---------------- 小程序端 ---------------- */

@ApiTags('member-cards')
@Controller('member-cards')
export class MemberCardPublicController {
  constructor(private readonly service: MemberCommerceService) {}

  @Get('plans')
  @ApiOperation({ summary: '可购买的会员卡方案' })
  plans() {
    return this.service.cardPlans(false);
  }
}

@ApiTags('member-cards')
@ApiBearerAuth()
@UseGuards(UserJwtGuard)
@Controller('member-cards')
export class MemberCardController {
  constructor(private readonly service: MemberCommerceService) {}

  @Get('mine')
  @ApiOperation({ summary: '我的会员卡与储值余额' })
  mine(@CurrentUser() user: MiniappUser) {
    return this.service.myMembership(user.sub);
  }

  @Post('purchase')
  @HttpCode(200)
  @ApiOperation({ summary: '使用储值余额购买会员卡，权益立即生效' })
  purchase(@CurrentUser() user: MiniappUser, @Body() dto: PlanIdDto) {
    return this.service.purchaseCard(user.sub, dto.planId);
  }
}

@ApiTags('stored-value')
@ApiBearerAuth()
@UseGuards(UserJwtGuard)
@Controller('stored-value')
export class StoredValueController {
  constructor(private readonly service: MemberCommerceService) {}

  @Get()
  @ApiOperation({ summary: '储值余额、充值套餐与最近流水' })
  wallet(@CurrentUser() user: MiniappUser) {
    return this.service.wallet(user.sub);
  }

  @Post('recharge')
  @HttpCode(200)
  @ApiOperation({ summary: '储值充值（本地测试渠道直接入账）' })
  recharge(@CurrentUser() user: MiniappUser, @Body() dto: PlanIdDto) {
    return this.service.recharge(user.sub, dto.planId);
  }
}

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(UserJwtGuard)
@Controller('orders')
export class OrderBalancePayController {
  constructor(private readonly service: MemberCommerceService) {}

  @Post(':id/pay-balance')
  @HttpCode(200)
  @ApiOperation({ summary: '储值余额支付订单（与微信支付互斥）' })
  pay(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.service.payOrderWithBalance(user.sub, id);
  }
}

/* ---------------- 后台 ---------------- */

@ApiTags('admin-member')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/member-card-plans')
export class AdminCardPlanController {
  constructor(private readonly service: MemberCommerceService) {}

  @Get()
  @Permission('membercard.view')
  @ApiOperation({ summary: '会员卡方案列表（含停用项）' })
  list() {
    return this.service.cardPlans(true);
  }

  @Post()
  @Permission('membercard.manage')
  @ApiOperation({ summary: '新增会员卡方案' })
  create(@Body() dto: CardPlanDto) {
    return this.service.createCardPlan(dto);
  }

  @Patch(':id')
  @Permission('membercard.manage')
  @ApiOperation({ summary: '修改会员卡方案' })
  update(@Param('id') id: string, @Body() dto: CardPlanDto) {
    return this.service.updateCardPlan(id, dto);
  }
}

@ApiTags('admin-member')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/member-cards')
export class AdminMemberCardController {
  constructor(private readonly service: MemberCommerceService) {}

  @Get()
  @Permission('membercard.view')
  @ApiOperation({ summary: '用户会员卡台账' })
  list(
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.adminCards({
      keyword,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    });
  }
}

@ApiTags('admin-member')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/recharge-plans')
export class AdminRechargePlanController {
  constructor(private readonly service: MemberCommerceService) {}

  @Get()
  @Permission('membercard.view')
  @ApiOperation({ summary: '充值套餐列表（含停用项）' })
  list() {
    return this.service.rechargePlans(true);
  }

  @Post()
  @Permission('membercard.manage')
  @ApiOperation({ summary: '新增充值套餐' })
  create(@Body() dto: RechargePlanDto) {
    return this.service.createRechargePlan(dto);
  }

  @Patch(':id')
  @Permission('membercard.manage')
  @ApiOperation({ summary: '修改充值套餐' })
  update(@Param('id') id: string, @Body() dto: RechargePlanDto) {
    return this.service.updateRechargePlan(id, dto);
  }
}

@ApiTags('admin-member')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/stored-value')
export class AdminStoredValueController {
  constructor(private readonly service: MemberCommerceService) {}

  @Get('accounts')
  @Permission('membercard.view')
  @ApiOperation({ summary: '储值账户台账' })
  accounts(
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.adminAccounts({
      keyword,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    });
  }

  @Get('ledger')
  @Permission('membercard.view')
  @ApiOperation({ summary: '储值流水（可按用户筛选）' })
  ledger(
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.adminLedger({
      userId,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    });
  }

  @Post('adjust')
  @HttpCode(200)
  @Permission('membercard.manage')
  @ApiOperation({ summary: '后台调整储值余额（记流水）' })
  adjust(@Body() dto: AdjustBalanceDto) {
    return this.service.adjustBalance(dto.userId, dto.deltaCents, dto.reason);
  }
}

@ApiTags('admin-member')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/recharge-orders')
export class AdminRechargeOrderController {
  constructor(private readonly service: MemberCommerceService) {}

  @Get()
  @Permission('membercard.view')
  @ApiOperation({ summary: '充值记录' })
  list(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.service.adminRechargeOrders(Number(page) || 1, Number(pageSize) || 20);
  }
}
