import { BadRequestException } from '@nestjs/common';

import type {
  CallbackResult,
  CreatePaymentInput,
  PaymentParams,
  PaymentProvider,
} from '../payment.provider';
import { WechatPayClient } from './wechat-pay.client';
import type { WechatPayConfig } from './wechat-pay.config';

/** 微信支付 APIv3 JSAPI 渠道实现 */
export class WechatPaymentProvider implements PaymentProvider {
  readonly name = 'wechat' as const;

  private readonly client: WechatPayClient;

  constructor(config: WechatPayConfig) {
    this.client = new WechatPayClient(config);
  }

  async createPayment(input: CreatePaymentInput): Promise<PaymentParams> {
    if (!input.openid) {
      throw new BadRequestException('微信支付需要用户 openid，请重新进入小程序');
    }
    const outTradeNo = input.outTradeNo ?? input.orderNo;
    const result = await this.client.createJsapiPayment({
      outTradeNo,
      description: `山野商城订单 ${input.orderNo}`,
      amountCents: input.amountCents,
      openid: input.openid,
    });

    return {
      provider: 'wechat',
      orderNo: input.orderNo,
      prepayId: result.prepayId,
      payParams: result.payParams,
    };
  }

  async verifyCallback(
    headers: Record<string, string | undefined>,
    rawBody: string,
  ): Promise<CallbackResult> {
    const resource = await this.client.verifyNotification(headers, rawBody);

    const outTradeNo = typeof resource.out_trade_no === 'string' ? resource.out_trade_no : '';
    const amount = resource.amount as { total?: unknown } | undefined;
    const amountCents = amount?.total;
    if (!outTradeNo || typeof amountCents !== 'number' || !Number.isInteger(amountCents)) {
      throw new BadRequestException('微信支付回调参数不合法');
    }

    const tradeState = typeof resource.trade_state === 'string' ? resource.trade_state : '';
    const successTime = typeof resource.success_time === 'string' ? resource.success_time : '';

    return {
      outTradeNo,
      transactionId:
        typeof resource.transaction_id === 'string' ? resource.transaction_id : '',
      status: tradeState === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      amountCents,
      paidAt: successTime ? new Date(successTime) : new Date(),
    };
  }
}
