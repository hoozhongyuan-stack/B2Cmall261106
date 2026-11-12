import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

import { PointsMallService } from './points-mall.service';
import { CurrentUser, UserJwtGuard, type MiniappUser } from '../../common/user-auth.guard';
import { JwtAuthGuard, RolesGuard, Permission } from '../../common/auth.guards';

class ExchangeDto {
  @IsString()
  skuId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  addressId?: string;

  @IsOptional()
  @IsString()
  fulfillmentType?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

@ApiTags('points-mall')
@Controller('points-mall')
export class PointsMallController {
  constructor(private readonly service: PointsMallService) {}

  @Get('products')
  @ApiOperation({ summary: '积分商品列表（仅上架且有库存）' })
  products(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.service.listProducts({
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    });
  }
}

@ApiTags('points-mall')
@ApiBearerAuth()
@UseGuards(UserJwtGuard)
@Controller('member/points-mall')
export class MemberPointsMallController {
  constructor(private readonly service: PointsMallService) {}

  @Get('limits')
  @ApiOperation({ summary: '当前用户已兑 / 剩余可兑与积分余额' })
  limits(@CurrentUser() user: MiniappUser, @Query('productId') productId: string) {
    return this.service.limits(user.sub, productId);
  }

  @Post('orders')
  @ApiOperation({ summary: '积分兑换下单（纯积分直接完成，积分+钱返回待支付订单）' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '客户端生成的 UUID' })
  exchange(
    @CurrentUser() user: MiniappUser,
    @Body() dto: ExchangeDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.exchange(user.sub, dto, key);
  }
}

@ApiTags('admin-points-mall')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/points-mall')
export class AdminPointsMallController {
  constructor(private readonly service: PointsMallService) {}

  @Post('orders/:id/refund')
  @HttpCode(200)
  @Permission('order.refund')
  @ApiOperation({ summary: '积分兑换单整单退款：返还积分、回补库存、回退限兑' })
  refund(@Param('id') id: string) {
    return this.service.refundOrder(id);
  }
}
