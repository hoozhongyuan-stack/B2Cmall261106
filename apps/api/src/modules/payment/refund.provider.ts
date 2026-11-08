import { randomBytes } from 'node:crypto';

export interface RefundResult {
  transactionId: string;
  /** PROCESSING：渠道受理但未出最终结果，退款单保持待处理 */
  status: 'SUCCESS' | 'FAILED' | 'PROCESSING';
  failReason?: string;
  /** 渠道原始响应，便于排查 */
  raw?: unknown;
}

export interface RefundInput {
  refundNo: string;
  orderNo: string;
  amountCents: number;
  /** 订单实付总额，微信退款 amount.total 必填 */
  totalCents?: number;
  /** 渠道交易号（微信 transaction_id） */
  transactionId?: string;
  reason?: string;
}

/**
 * 退款渠道适配（与支付适配同构）。
 * 首版只有 Mock；接真实微信退款时新增实现并改注册即可。
 */
export interface RefundProvider {
  readonly name: string;
  refund(input: RefundInput): Promise<RefundResult>;
}

export class MockRefundProvider implements RefundProvider {
  readonly name = 'mock';

  async refund(input: RefundInput): Promise<RefundResult> {
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
