import { describe, expect, it } from 'vitest';

import {
  calculateDeliveryFee,
  checkDeliverySlot,
  isDeliveryOverdue,
  matchDeliveryRegion,
} from '../src/delivery';

describe('同城配送费', () => {
  it('未达免配送门槛：收取门店固定配送费', () => {
    expect(
      calculateDeliveryFee({ goodsCents: 5900, fixedFeeCents: 800, freeThresholdCents: 9900 }),
    ).toBe(800);
  });

  it('刚好达到门槛：免配送费', () => {
    expect(
      calculateDeliveryFee({ goodsCents: 9900, fixedFeeCents: 800, freeThresholdCents: 9900 }),
    ).toBe(0);
  });

  it('门槛为 0 视为不设门槛，仍收固定配送费', () => {
    expect(
      calculateDeliveryFee({ goodsCents: 50000, fixedFeeCents: 800, freeThresholdCents: 0 }),
    ).toBe(800);
  });

  it('会员折扣不触发配送包邮：98 折后不足门槛仍收配送费', () => {
    // 12000 × 0.98 = 11760 < 12000
    const goodsCents = Math.round(12000 * 0.98);
    expect(goodsCents).toBe(11760);
    expect(
      calculateDeliveryFee({ goodsCents, fixedFeeCents: 800, freeThresholdCents: 12000 }),
    ).toBe(800);
  });

  it('非法金额抛错而不是静默', () => {
    expect(() =>
      calculateDeliveryFee({ goodsCents: -1, fixedFeeCents: 800, freeThresholdCents: 0 }),
    ).toThrow();
    expect(() =>
      calculateDeliveryFee({ goodsCents: 100, fixedFeeCents: 1.5, freeThresholdCents: 0 }),
    ).toThrow();
  });
});

describe('配送区县白名单', () => {
  const regions = ['云南省昆明市五华区', '盘龙区 / 官渡区'];

  it('完整区县命中', () => {
    expect(matchDeliveryRegion(regions, '云南省昆明市五华区')).toBe('云南省昆明市五华区');
  });

  it('地址含空格也能命中', () => {
    expect(matchDeliveryRegion(regions, '云南省 昆明市 五华区')).toBe('云南省昆明市五华区');
  });

  it('多区县配置按片段命中', () => {
    expect(matchDeliveryRegion(regions, '云南省昆明市官渡区')).toBe('盘龙区 / 官渡区');
  });

  it('地址只写区县也能与完整配置互相命中', () => {
    expect(matchDeliveryRegion(regions, '五华区')).toBe('云南省昆明市五华区');
  });

  it('范围外返回 null', () => {
    expect(matchDeliveryRegion(regions, '云南省昆明市西山区')).toBeNull();
  });

  it('空地址返回 null', () => {
    expect(matchDeliveryRegion(regions, '   ')).toBeNull();
    expect(matchDeliveryRegion(regions, '')).toBeNull();
  });
});

describe('配送时段与截单容量', () => {
  const slots = ['10:00-12:00', '14:00-16:00'];
  const at = (hour: number, minute = 0) => new Date(2026, 10, 8, hour, minute);

  it('可选时段通过', () => {
    expect(
      checkDeliverySlot({ slot: '10:00-12:00', slots, cutoff: '18:00', now: at(9) }),
    ).toEqual({ ok: true });
  });

  it('时段格式错误', () => {
    const result = checkDeliverySlot({ slot: '10:00', slots, now: at(9) });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: '配送时段格式需为 10:00-12:00' });
  });

  it('结束时间不晚于开始时间', () => {
    const result = checkDeliverySlot({ slot: '12:00-10:00', slots: ['12:00-10:00'], now: at(9) });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: '配送时段结束时间需晚于开始时间' });
  });

  it('不在门店配送时段内', () => {
    const result = checkDeliverySlot({ slot: '13:00-15:00', slots, now: at(9) });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: '该时段不在门店配送范围内' });
  });

  it('时段已结束', () => {
    const result = checkDeliverySlot({ slot: '10:00-12:00', slots, now: at(12) });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: '该配送时段已结束' });
  });

  it('已过截单时间', () => {
    const result = checkDeliverySlot({
      slot: '14:00-16:00',
      slots,
      cutoff: '13:00',
      now: at(13, 30),
    });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: '今日已截单，请选择明日配送' });
  });

  it('未到截单时间可通过', () => {
    expect(
      checkDeliverySlot({
        slot: '14:00-16:00',
        slots,
        cutoff: '13:00',
        now: at(12, 59),
      }),
    ).toEqual({ ok: true });
  });

  it('截单时间配置非法', () => {
    const result = checkDeliverySlot({
      slot: '10:00-12:00',
      slots,
      cutoff: '25:00',
      now: at(9),
    });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: '门店截单时间配置不合法' });
  });

  it('时段约满', () => {
    const result = checkDeliverySlot({
      slot: '10:00-12:00',
      slots,
      now: at(9),
      bookedCount: 5,
      maxOrdersPerSlot: 5,
    });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: '该配送时段已约满' });
  });

  it('容量未满可通过', () => {
    expect(
      checkDeliverySlot({
        slot: '10:00-12:00',
        slots,
        now: at(9),
        bookedCount: 4,
        maxOrdersPerSlot: 5,
      }),
    ).toEqual({ ok: true });
  });

  it('容量 0 表示不限', () => {
    expect(
      checkDeliverySlot({
        slot: '10:00-12:00',
        slots,
        now: at(9),
        bookedCount: 999,
        maxOrdersPerSlot: 0,
      }),
    ).toEqual({ ok: true });
  });
});

describe('配送超时判定', () => {
  const now = new Date('2026-11-08T12:00:00');
  const before = (minutes: number) =>
    new Date(now.getTime() - minutes * 60_000);

  it('待接单超过 15 分钟为超时', () => {
    expect(
      isDeliveryOverdue({ status: 'PENDING', createdAt: before(16), now }),
    ).toBe(true);
    expect(
      isDeliveryOverdue({ status: 'PENDING', createdAt: before(14), now }),
    ).toBe(false);
  });

  it('接单后超过 60 分钟未送达为超时', () => {
    expect(
      isDeliveryOverdue({
        status: 'ACCEPTED',
        createdAt: before(120),
        acceptedAt: before(61),
        now,
      }),
    ).toBe(true);
    expect(
      isDeliveryOverdue({
        status: 'ACCEPTED',
        createdAt: before(120),
        acceptedAt: before(59),
        now,
      }),
    ).toBe(false);
  });

  it('已送达与已取消不计超时', () => {
    expect(
      isDeliveryOverdue({ status: 'DELIVERED', createdAt: before(180), now }),
    ).toBe(false);
    expect(
      isDeliveryOverdue({ status: 'CANCELLED', createdAt: before(180), now }),
    ).toBe(false);
  });

  it('缺少接单时间时按创建时间计算', () => {
    expect(
      isDeliveryOverdue({ status: 'ACCEPTED', createdAt: before(61), now }),
    ).toBe(true);
  });
});
