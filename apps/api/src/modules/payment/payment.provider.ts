import { randomBytes } from 'node:crypto';

export interface PaymentParams {
  provider: 'mock' | 'wechat';
  orderNo: string;
  prepayId?: string;
  mockConfirmUrl?: string;
  /** 微信支付 JSAPI 调起参数（仅 wechat） */
  payParams?: {
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: 'RSA';
    paySign: string;
  };
}

export interface CreatePaymentInput {
  /** 业务订单号（展示与 mock 使用） */
  orderNo: string;
  /** 渠道交易单号：微信支付 out_trade_no，回调按它匹配支付单 */
  outTradeNo?: string;
  amountCents: number;
  openid?: string;
}

export interface CallbackResult {
  outTradeNo: string;
  transactionId: string;
  status: 'SUCCESS' | 'FAILED';
  amountCents: number;
  paidAt: Date;
}

/**
 * 支付渠道适配层（技术方案 §09）
 * 首版只有 MockProvider；接微信支付时新增实现并改注册，订单与售后代码零改动。
 */
export interface PaymentProvider {
  readonly name: 'mock' | 'wechat';
  createPayment(input: CreatePaymentInput): Promise<PaymentParams>;
  verifyCallback(headers: Record<string, string | undefined>, rawBody: string): Promise<CallbackResult>;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;

  async createPayment(input: { orderNo: string }): Promise<PaymentParams> {
    return {
      provider: 'mock',
      orderNo: input.orderNo,
      prepayId: `mock_prepay_${randomBytes(4).toString('hex')}`,
      // 前端点击「确认支付」后调用该地址，走与真实回调相同的处理逻辑
      mockConfirmUrl: '/api/payments/mock/confirm',
    };
  }

  async verifyCallback(
    _headers: Record<string, string | undefined>,
    rawBody: string,
  ): Promise<CallbackResult> {
    const body = JSON.parse(rawBody) as {
      outTradeNo: string;
      amountCents: number;
      status?: 'SUCCESS' | 'FAILED';
    };
    if (!body.outTradeNo || !Number.isInteger(body.amountCents)) {
      throw new Error('回调参数不合法');
    }
    return {
      outTradeNo: body.outTradeNo,
      transactionId: `mock_txn_${randomBytes(6).toString('hex')}`,
      status: body.status ?? 'SUCCESS',
      amountCents: body.amountCents,
      paidAt: new Date(),
    };
  }
}
