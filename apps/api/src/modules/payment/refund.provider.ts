import { randomBytes } from 'node:crypto';

export interface RefundResult {
  transactionId: string;
  status: 'SUCCESS' | 'FAILED';
  failReason?: string;
}

/**
 * 退款渠道适配（与支付适配同构）。
 * 首版只有 Mock；接真实微信退款时新增实现并改注册即可。
 */
export interface RefundProvider {
  readonly name: string;
  refund(input: { refundNo: string; orderNo: string; amountCents: number }): Promise<RefundResult>;
}

export class MockRefundProvider implements RefundProvider {
  readonly name = 'mock';

  async refund(input: { amountCents: number }): Promise<RefundResult> {
    // 金额非法时模拟渠道拒绝，用于验证失败分支
    if (input.amountCents <= 0) {
      return { transactionId: '', status: 'FAILED', failReason: '退款金额必须大于 0' };
    }
    return {
      transactionId: `mock_refund_${randomBytes(6).toString('hex')}`,
      status: 'SUCCESS',
    };
  }
}
