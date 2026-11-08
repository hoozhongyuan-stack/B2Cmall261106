import type { RefundInput, RefundProvider, RefundResult } from './refund.provider';

/** 储值余额退款：渠道即时成功，余额回退在售后完成事务内落账 */
export class BalanceRefundProvider implements RefundProvider {
  readonly name = 'balance';

  async refund(input: RefundInput): Promise<RefundResult> {
    if (input.amountCents <= 0) {
      return { transactionId: '', status: 'FAILED', failReason: '退款金额必须大于 0' };
    }
    return {
      transactionId: `BALREF:${input.refundNo}`,
      status: 'SUCCESS',
      raw: { provider: 'balance', refundNo: input.refundNo },
    };
  }
}
