import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

import { AfterSaleService } from './aftersale.service';
import { CurrentUser, UserJwtGuard, type MiniappUser } from '../../common/user-auth.guard';
import { JwtAuthGuard, Roles, RolesGuard } from '../../common/auth.guards';

class ApplyDto {
  @IsString()
  orderItemId!: string;

  @IsIn(['REFUND_ONLY', 'RETURN_REFUND'])
  type!: 'REFUND_ONLY' | 'RETURN_REFUND';

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  refundCents?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidence?: string[];
}

class ShipBackDto {
  @IsString()
  trackingNo!: string;
}

class ModerateDto {
  @IsIn(['approve_only_refund', 'approve_return', 'reject'])
  action!: 'approve_only_refund' | 'approve_return' | 'reject';

  @IsOptional()
  @IsString()
  rejectReason?: string;
}

@ApiTags('after-sales')
@ApiBearerAuth()
@UseGuards(UserJwtGuard)
@Controller('after-sales')
export class AfterSaleController {
  constructor(private readonly service: AfterSaleService) {}

  @Post()
  @ApiOperation({ summary: '提交售后申请' })
  apply(@CurrentUser() user: MiniappUser, @Body() dto: ApplyDto) {
    return this.service.apply(user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: '我的售后列表' })
  list(@CurrentUser() user: MiniappUser) {
    return this.service.listMine(user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: '售后详情' })
  detail(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.service.viewMine(user.sub, id);
  }

  @Post(':id/ship-back')
  @HttpCode(200)
  @ApiOperation({ summary: '买家填写寄回单号' })
  shipBack(
    @CurrentUser() user: MiniappUser,
    @Param('id') id: string,
    @Body() dto: ShipBackDto,
  ) {
    return this.service.shipBack(user.sub, id, dto.trackingNo);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: '买家撤销售后（仅待审核阶段）' })
  cancel(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.service.cancelMine(user.sub, id);
  }
}

@ApiTags('admin-after-sales')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/after-sales')
export class AdminAfterSaleController {
  constructor(private readonly service: AfterSaleService) {}

  @Get()
  @Roles('SUPER', 'OPS', 'CS', 'WMS')
  @ApiOperation({ summary: '售后列表（含各状态数量，分页）' })
  list(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listAdmin(status, Number(page) || 1, Number(pageSize) || 20);
  }

  @Get(':id')
  @Roles('SUPER', 'OPS', 'CS', 'WMS')
  @ApiOperation({ summary: '售后详情' })
  detail(@Param('id') id: string) {
    return this.service.detailAdmin(id);
  }

  @Post(':id/moderate')
  @HttpCode(200)
  @Roles('SUPER', 'CS')
  @ApiOperation({ summary: '审核：同意仅退款 / 同意退货 / 拒绝' })
  moderate(@Param('id') id: string, @Body() dto: ModerateDto) {
    return this.service.approve(id, dto.action, dto.rejectReason);
  }

  @Post(':id/receive')
  @HttpCode(200)
  @Roles('SUPER', 'WMS')
  @ApiOperation({ summary: '确认收到退货并发起退款' })
  receive(@Param('id') id: string) {
    return this.service.receive(id);
  }
}
