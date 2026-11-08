/**
 * 同城配送规则：全项目唯一实现（工程契约 R4）
 * 纯函数，不依赖数据库；服务端校验与前端展示共用。
 */

export interface DeliveryFeeInput {
  /** 会员折扣与优惠后、用于判断门槛的商品金额（分） */
  goodsCents: number;
  /** 门店固定配送费（分） */
  fixedFeeCents: number;
  /** 免配送费门槛（分）；<= 0 表示不设门槛，始终收取固定配送费 */
  freeThresholdCents: number;
}

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} 必须为非负整数分，收到 ${value}`);
  }
}

/**
 * 同城配送费：固定配送费 + 满额免配送费。
 * 会员包邮只作用于快递，本函数不接受会员包邮参数，因此不可能把配送费降为 0。
 */
export function calculateDeliveryFee(input: DeliveryFeeInput): number {
  assertNonNegativeInt(input.goodsCents, '商品金额');
  assertNonNegativeInt(input.fixedFeeCents, '配送费');
  assertNonNegativeInt(input.freeThresholdCents, '免配送门槛');

  if (input.freeThresholdCents > 0 && input.goodsCents >= input.freeThresholdCents) {
    return 0;
  }
  return input.fixedFeeCents;
}

const SLOT_PATTERN = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeRegion(value: string): string {
  return value.replace(/\s+/g, '');
}

function toMinutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

/**
 * 门店配送区县白名单匹配。
 * 区县名允许写成「五华区 / 盘龙区」，按片段匹配；地址与配置互相包含均可命中。
 * 返回命中的配置项，未命中返回 null。
 */
export function matchDeliveryRegion(regions: string[], addressRegion: string): string | null {
  const address = normalizeRegion(addressRegion ?? '');
  if (!address) return null;

  for (const region of regions) {
    const parts = region
      .split('/')
      .map(normalizeRegion)
      .filter(Boolean);
    if (parts.some((part) => address.includes(part) || part.includes(address))) {
      return region;
    }
  }
  return null;
}

export interface DeliverySlotInput {
  /** 下单选择的时段，格式 HH:mm-HH:mm */
  slot: string;
  /** 门店配置的配送时段列表 */
  slots: string[];
  /** 每日截单时间 HH:mm；空表示不截单 */
  cutoff?: string | null;
  now: Date;
  /** 该时段已占用单量，默认 0 */
  bookedCount?: number;
  /** 每时段最大单量，<= 0 表示不限 */
  maxOrdersPerSlot?: number;
}

/* ---------------- 配送时效 ---------------- */

/** 待接单超过 15 分钟即超时 */
export const DELIVERY_PENDING_TIMEOUT_MINUTES = 15;
/** 接单后超过 60 分钟未送达即超时 */
export const DELIVERY_ACCEPTED_TIMEOUT_MINUTES = 60;

export interface DeliveryTimingInput {
  status: string;
  createdAt: Date | string;
  acceptedAt?: Date | string | null;
  now?: Date;
}

/** 配送单是否超时：待接单看创建时间，配送中看接单时间 */
export function isDeliveryOverdue(input: DeliveryTimingInput): boolean {
  const now = (input.now ?? new Date()).getTime();
  if (input.status === 'PENDING') {
    return (
      now - new Date(input.createdAt).getTime() > DELIVERY_PENDING_TIMEOUT_MINUTES * 60_000
    );
  }
  if (input.status === 'ACCEPTED') {
    return (
      now - new Date(input.acceptedAt ?? input.createdAt).getTime() >
      DELIVERY_ACCEPTED_TIMEOUT_MINUTES * 60_000
    );
  }
  return false;
}

export type DeliverySlotCheck = { ok: true } | { ok: false; reason: string };

/**
 * 配送时段校验：格式、是否在门店时段内、是否已结束、是否已截单、是否约满。
 * 只校验当天配送，调用方无需传日期。
 */
export function checkDeliverySlot(input: DeliverySlotInput): DeliverySlotCheck {
  if (!SLOT_PATTERN.test(input.slot)) {
    return { ok: false, reason: '配送时段格式需为 10:00-12:00' };
  }
  const startMin = toMinutes(input.slot.slice(0, 5));
  const endMin = toMinutes(input.slot.slice(6, 11));
  if (endMin <= startMin) {
    return { ok: false, reason: '配送时段结束时间需晚于开始时间' };
  }
  if (!input.slots.includes(input.slot)) {
    return { ok: false, reason: '该时段不在门店配送范围内' };
  }

  const nowMin = input.now.getHours() * 60 + input.now.getMinutes();
  if (nowMin >= endMin) {
    return { ok: false, reason: '该配送时段已结束' };
  }

  if (input.cutoff) {
    if (!TIME_PATTERN.test(input.cutoff)) {
      return { ok: false, reason: '门店截单时间配置不合法' };
    }
    if (nowMin >= toMinutes(input.cutoff)) {
      return { ok: false, reason: '今日已截单，请选择明日配送' };
    }
  }

  const max = input.maxOrdersPerSlot ?? 0;
  const booked = input.bookedCount ?? 0;
  if (max > 0 && booked >= max) {
    return { ok: false, reason: '该配送时段已约满' };
  }
  return { ok: true };
}
