import { describe, expect, it } from 'vitest';

import {
  allocateDiscount,
  allocateLinePaidCents,
  assertAmountSelfConsistent,
  calculateOrderAmount,
  formatCents,
  type AmountInput,
} from '../src/money';

const freight = { freeThresholdCents: 9900, flatCents: 1000 };

function calc(over: Partial<AmountInput> = {}) {
  return calculateOrderAmount({
    items: [{ priceCents: 26800, quantity: 1 }],
    freight,
    ...over,
  });
}

describe('金额计算矩阵（契约 R4）', () => {
  it('1 · 未达包邮门槛：收取固定运费', () => {
    const r = calc({ items: [{ priceCents: 5000, quantity: 1 }] });
    expect(r.freightCents).toBe(1000);
    expect(r.payableCents).toBe(6000);
  });

  it('2 · 刚好达到门槛（¥99）：免运费', () => {
    const r = calc({ items: [{ priceCents: 9900, quantity: 1 }] });
    expect(r.freightCents).toBe(0);
    expect(r.payableCents).toBe(9900);
  });

  it('3 · 差 1 分未达门槛：仍收运费', () => {
    const r = calc({ items: [{ priceCents: 9899, quantity: 1 }] });
    expect(r.freightCents).toBe(1000);
    expect(r.payableCents).toBe(10899);
  });

  it('4 · 会员 98 折：折扣四舍五入到分（券后仍超包邮门槛）', () => {
    const r = calc({ items: [{ priceCents: 26800, quantity: 1 }], memberDiscountRate: 0.98 });
    expect(r.memberDiscountCents).toBe(536);
    expect(r.freightCents).toBe(0);
    expect(r.payableCents).toBe(26264);
  });

  it('5 · 券门槛按会员折扣后金额判断：差 1 分不可用', () => {
    const r = calc({
      items: [{ priceCents: 40000, quantity: 1 }],
      memberDiscountRate: 0.98,
      coupon: { thresholdCents: 40000, faceValueCents: 3000 },
    });
    // 40000 - 800 = 39200 < 40000，券不生效
    expect(r.couponCents).toBe(0);
    expect(r.payableCents).toBe(39200);
  });

  it('6 · 券门槛按会员折扣后金额判断：刚好达到可用', () => {
    const r = calc({
      items: [{ priceCents: 40817, quantity: 1 }],
      memberDiscountRate: 0.98,
      coupon: { thresholdCents: 40000, faceValueCents: 3000 },
    });
    expect(r.memberDiscountCents).toBe(816);
    expect(r.couponCents).toBe(3000);
    expect(r.payableCents).toBe(40817 - 816 - 3000);
  });

  it('7 · 券面额大于券后金额：最多抵扣到 0 元商品部分', () => {
    const r = calc({
      items: [{ priceCents: 2000, quantity: 1 }],
      coupon: { thresholdCents: 0, faceValueCents: 5000 },
    });
    expect(r.couponCents).toBe(2000);
    expect(r.payableCents).toBe(1000); // 只剩运费
  });

  it('8 · 包邮判定用券后金额：用券后不足门槛则收运费', () => {
    const r = calc({
      items: [{ priceCents: 10000, quantity: 1 }],
      coupon: { thresholdCents: 0, faceValueCents: 500 },
    });
    expect(r.couponCents).toBe(500);
    expect(r.freightCents).toBe(1000); // 9500 < 9900
    expect(r.payableCents).toBe(10500);
  });

  it('9 · 地区例外：即使超门槛也收运费', () => {
    const r = calc({
      items: [{ priceCents: 20000, quantity: 1 }],
      freight: { ...freight, isExceptionRegion: true },
    });
    expect(r.freightCents).toBe(1000);
    expect(r.payableCents).toBe(21000);
  });

  it('10 · 多件商品：合计正确且金额自洽', () => {
    const r = calculateOrderAmount({
      items: [
        { priceCents: 26800, quantity: 1 },
        { priceCents: 9800, quantity: 2 },
      ],
      memberDiscountRate: 0.98,
      coupon: { thresholdCents: 40000, faceValueCents: 3000 },
      freight,
    });
    expect(r.goodsCents).toBe(46400);
    expect(r.memberDiscountCents).toBe(928);
    expect(r.couponCents).toBe(3000);
    expect(r.payableCents).toBe(46400 - 928 - 3000);
    expect(() => assertAmountSelfConsistent(r)).not.toThrow();
  });

  it('11 · 数量非法直接抛错', () => {
    expect(() => calc({ items: [{ priceCents: 1000, quantity: 0 }] })).toThrow(/数量/);
  });

  it('12 · 非整数分直接抛错', () => {
    expect(() => calc({ items: [{ priceCents: 10.5, quantity: 1 }] })).toThrow(/整数分/);
  });

  it('13 · 空商品抛错', () => {
    expect(() => calc({ items: [] })).toThrow(/至少需要一件商品/);
  });

  it('14 · 折扣率越界抛错', () => {
    expect(() => calc({ memberDiscountRate: 0 })).toThrow(/折扣率非法/);
    expect(() => calc({ memberDiscountRate: 1.2 })).toThrow(/折扣率非法/);
  });

  it('15 · 券面额为负时按 0 处理，不会放大应付', () => {
    const r = calc({ coupon: { thresholdCents: 0, faceValueCents: -500 } });
    expect(r.couponCents).toBe(0);
    expect(r.payableCents).toBe(26800);
  });
});

describe('金额工具', () => {
  it('格式化保留两位小数', () => {
    expect(formatCents(43400)).toBe('¥434.00');
    expect(formatCents(0)).toBe('¥0.00');
  });

  it('优惠按占比分摊，合计精确等于总优惠（余数给最后一行）', () => {
    const alloc = allocateDiscount(1000, [3333, 3333, 3334]);
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(alloc).toEqual([333, 333, 334]);
  });

  it('无优惠时分摊全为 0', () => {
    expect(allocateDiscount(0, [100, 200])).toEqual([0, 0]);
    expect(allocateDiscount(500, [])).toEqual([]);
    expect(allocateDiscount(500, [0, 0])).toEqual([0, 0]);
  });

  it('行实付 = 原价 - 会员折扣 - 券，且各行合计等于商品实付', () => {
    const lines = [
      { priceCents: 5900, quantity: 1 },
      { priceCents: 1000, quantity: 2 },
    ];
    const paid = allocateLinePaidCents({ lines, memberDiscountCents: 158, couponCents: 300 });
    expect(paid.reduce((a, b) => a + b, 0)).toBe(7900 - 158 - 300);
    expect(paid[0]).toBeGreaterThan(paid[1]);
  });

  it('会员折扣订单：行实付低于原价，退款上限不能按原价算', () => {
    const [paid] = allocateLinePaidCents({
      lines: [{ priceCents: 5900, quantity: 1 }],
      memberDiscountCents: 118,
      couponCents: 0,
    });
    expect(paid).toBe(5782);
    expect(paid).toBeLessThan(5900);
  });
});

describe('金额自检', () => {
  it('伪造快照会被自检拦下', () => {
    expect(() =>
      assertAmountSelfConsistent({
        goodsCents: 100,
        memberDiscountCents: 10,
        couponCents: 20,
        freightCents: 5,
        payableCents: 999,
      }),
    ).toThrow(/金额不自洽/);
  });
});
