import type { RefundProvider, RefundResult } from '../refund.provider';
import { WechatPayClient } from './wechat-pay.client';
import type { WechatPayConfig } from './wechat-pay.config';

/** 微信支付 APIv3 退款渠道实现 */
export class WechatRefundProvider implements RefundProvider {
  readonly name = 'wechat';

  private readonly client: WechatPayClient;

  constructor(config: WechatPayConfig) {
    this.client = new WechatPayClient(config);
  }

  async refund(input: {
    refundNo: string;
    orderNo: string;
    amountCents: number;
    totalCents?: number;
    transactionId?: string;
    reason?: string;
  }): Promise<RefundResult> {
    try {
      const res = await this.client.refund({
        refundNo: input.refundNo,
        transactionId: input.transactionId,
        outTradeNo: input.orderNo,
        amountCents: input.amountCents,
        totalCents: input.totalCents ?? input.amountCents,
        reason: input.reason,
      });

      if (res.status === 'SUCCESS') {
        return { transactionId: res.refundId, status: 'SUCCESS', raw: res.raw };
      }
      if (res.status === 'PROCESSING') {
        return { transactionId: res.refundId, status: 'PROCESSING', raw: res.raw };
      }
      return {
        transactionId: res.refundId,
        status: 'FAILED',
        failReason: `微信退款状态：${res.status || '未知'}`,
        raw: res.raw,
      };
    } catch (err) {
      // 渠道明确拒绝时返回失败，保留退款单以便后台重试（out_refund_no 在微信侧幂等）
      return {
        transactionId: '',
        status: 'FAILED',
        failReason: err instanceof Error ? err.message : '微信退款失败',
      };
    }
  }
}
