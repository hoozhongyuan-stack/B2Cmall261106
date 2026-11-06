import { describe, expect, it } from 'vitest';

import {
  buyerActions,
  can,
  canAfterSale,
  nextAfterSaleStatus,
  nextStatus,
  ORDER_STATUS_LABEL,
} from '../src/orderState';

describe('订单状态机', () => {
  it('待付款 → 支付成功 → 待发货', () => {
    expect(nextStatus('PENDING_PAYMENT', 'pay_success')).toBe('PAID');
  });

  it('待付款 → 取消 → 已关闭', () => {
    expect(nextStatus('PENDING_PAYMENT', 'cancel')).toBe('CLOSED');
  });

  it('待发货 → 发货 → 待收货', () => {
    expect(nextStatus('PAID', 'ship')).toBe('SHIPPED');
  });

  it('待收货 → 确认收货 → 已完成', () => {
    expect(nextStatus('SHIPPED', 'confirm')).toBe('COMPLETED');
  });

  it('售后中拒绝，必须回到申请前状态', () => {
    expect(nextStatus('REFUNDING', 'refund_reject', { previousStatus: 'SHIPPED' })).toBe('SHIPPED');
    expect(() => nextStatus('REFUNDING', 'refund_reject')).toThrow(/原状态/);
    expect(() => nextStatus('REFUNDING', 'refund_reject', { previousStatus: 'CLOSED' })).toThrow(
      /原状态/,
    );
  });

  it('已关闭订单不能发货：抛错而不是静默', () => {
    expect(can('CLOSED', 'ship')).toBe(false);
    expect(() => nextStatus('CLOSED', 'ship')).toThrow(/非法状态迁移/);
  });

  it('已退款订单不能再退款', () => {
    expect(can('REFUNDED', 'refund_apply')).toBe(false);
  });

  it('买家按钮：待付款可支付/取消，待收货可确认/售后', () => {
    expect(buyerActions('PENDING_PAYMENT')).toEqual(['pay_success', 'cancel']);
    expect(buyerActions('SHIPPED')).toEqual(['confirm', 'refund_apply']);
    expect(buyerActions('CLOSED')).toEqual([]);
  });

  it('七种状态都有中文文案', () => {
    expect(Object.keys(ORDER_STATUS_LABEL)).toHaveLength(7);
    expect(ORDER_STATUS_LABEL.CLOSED).toBe('已关闭');
  });
});

describe('售后状态机', () => {
  it('仅退款通过：直接进入退款中', () => {
    expect(nextAfterSaleStatus('APPLIED', 'approve_only_refund')).toBe('REFUNDING');
  });

  it('退货退款：待买家寄回 → 待商家收货 → 退款中 → 完成', () => {
    expect(nextAfterSaleStatus('APPLIED', 'approve_return')).toBe('WAIT_BUYER_SHIP');
    expect(nextAfterSaleStatus('WAIT_BUYER_SHIP', 'buyer_ship')).toBe('WAIT_SELLER_RECEIVE');
    expect(nextAfterSaleStatus('WAIT_SELLER_RECEIVE', 'seller_receive')).toBe('REFUNDING');
    expect(nextAfterSaleStatus('REFUNDING', 'refund_success')).toBe('COMPLETED');
  });

  it('拒绝后不能继续推进', () => {
    expect(nextAfterSaleStatus('APPLIED', 'reject')).toBe('REJECTED');
    expect(canAfterSale('REJECTED', 'buyer_ship')).toBe(false);
  });

  it('退款失败留在退款中，允许重试', () => {
    expect(nextAfterSaleStatus('REFUNDING', 'refund_failed')).toBe('REFUNDING');
  });
});
