import { describe, expect, it } from 'vitest';

import {
  averageRating,
  clampPoints,
  couponClaimState,
  isValidRating,
  nextMemberLevel,
  pointsForAmount,
  resolveMemberLevel,
} from '../src/loyalty';
import { isCompleted } from '../src/orderState';

const levels = [
  { name: '访客', thresholdCents: 0, discountRate: 1 },
  { name: '山民', thresholdCents: 50000, discountRate: 0.98 },
  { name: '常客', thresholdCents: 200000, discountRate: 0.95 },
];

describe('会员等级（按累计消费升级）', () => {
  it('累计消费为 0 时命中最低档', () => {
    expect(resolveMemberLevel(levels, 0)?.name).toBe('访客');
  });

  it('刚好达到门槛即升级', () => {
    expect(resolveMemberLevel(levels, 50000)?.name).toBe('山民');
    expect(resolveMemberLevel(levels, 49999)?.name).toBe('访客');
  });

  it('超过最高门槛取最高档', () => {
    expect(resolveMemberLevel(levels, 999999)?.name).toBe('常客');
  });

  it('同门槛取折扣更低的一档', () => {
    const tied = [
      { name: 'A', thresholdCents: 100, discountRate: 0.99 },
      { name: 'B', thresholdCents: 100, discountRate: 0.95 },
    ];
    expect(resolveMemberLevel(tied, 100)?.name).toBe('B');
  });

  it('无任何等级时返回 null', () => {
    expect(resolveMemberLevel([], 100)).toBeNull();
  });

  it('下一等级按门槛升序返回，已到顶为 null', () => {
    expect(nextMemberLevel(levels, 0)?.name).toBe('山民');
    expect(nextMemberLevel(levels, 50000)?.name).toBe('常客');
    expect(nextMemberLevel(levels, 300000)).toBeNull();
  });
});

describe('积分折算（不参与抵扣）', () => {
  it('每 1 元计 1 分，向下取整', () => {
    expect(pointsForAmount(10000)).toBe(100);
    expect(pointsForAmount(1099)).toBe(10);
  });

  it('非正数与非法输入返回 0', () => {
    expect(pointsForAmount(0)).toBe(0);
    expect(pointsForAmount(-100)).toBe(0);
    expect(pointsForAmount(10.5)).toBe(0);
  });

  it('扣减不允许出现负余额', () => {
    expect(clampPoints(100, -30)).toEqual({ balance: 70, applied: -30 });
    expect(clampPoints(20, -50)).toEqual({ balance: 0, applied: -20 });
    expect(clampPoints(0, 10)).toEqual({ balance: 10, applied: 10 });
  });
});

describe('优惠券状态', () => {
  const now = new Date('2026-11-06T12:00:00+08:00');

  it('已使用优先于过期', () => {
    expect(
      couponClaimState({ status: 'USED', expiresAt: '2026-11-01T00:00:00+08:00' }, now),
    ).toBe('USED');
  });

  it('未使用但已过期判定为过期', () => {
    expect(
      couponClaimState({ status: 'UNUSED', expiresAt: '2026-11-01T00:00:00+08:00' }, now),
    ).toBe('EXPIRED');
  });

  it('有效期内为未使用', () => {
    expect(
      couponClaimState({ status: 'UNUSED', expiresAt: '2026-11-30T23:59:59+08:00' }, now),
    ).toBe('UNUSED');
  });
});

describe('评价规则', () => {
  it('评分仅接受 1~5 的整数', () => {
    expect(isValidRating(1)).toBe(true);
    expect(isValidRating(5)).toBe(true);
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(4.5)).toBe(false);
  });

  it('平均分保留 1 位小数，空列表为 0', () => {
    expect(averageRating([5, 4, 4])).toBe(4.3);
    expect(averageRating([])).toBe(0);
  });

  it('仅已完成订单可评价', () => {
    expect(isCompleted('COMPLETED')).toBe(true);
    expect(isCompleted('SHIPPED')).toBe(false);
  });
});
