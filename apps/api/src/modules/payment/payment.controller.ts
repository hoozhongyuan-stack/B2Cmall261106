import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import type { Request } from 'express';

import { PaymentService } from './payment.service';
import { CurrentUser, UserJwtGuard, type MiniappUser } from '../../common/user-auth.guard';

class MockConfirmDto {
  @IsString()
  outTradeNo!: string;
}

@ApiTags('payments')
@Controller('payments')
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post('callback')
  @HttpCode(200)
  @ApiOperation({ summary: '支付回调（渠道 → 服务端，重复通知幂等）' })
  async callback(
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    // 微信支付验签依赖原始报文，不能使用重新序列化后的 body
    const raw = req.rawBody?.toString('utf8');
    if (!raw) throw new BadRequestException('缺少原始请求报文');
    return this.payments.handleCallback(raw, headers);
  }

  @Post('mock/confirm')
  @HttpCode(200)
  @UseGuards(UserJwtGuard)
  @ApiOperation({ summary: '模拟支付确认：与真实回调走同一处理逻辑' })
  mockConfirm(@CurrentUser() user: MiniappUser, @Body() dto: MockConfirmDto) {
    return this.payments.mockConfirm(user.sub, dto.outTradeNo);
  }
}

@ApiTags('payments')
@UseGuards(UserJwtGuard)
@Controller('orders')
export class OrderPayController {
  constructor(private readonly payments: PaymentService) {}

  @Post(':id/pay')
  @HttpCode(200)
  @ApiOperation({ summary: '发起支付，返回渠道参数' })
  pay(@CurrentUser() user: MiniappUser, @Param('id') id: string) {
    return this.payments.pay(user.sub, id);
  }
}
