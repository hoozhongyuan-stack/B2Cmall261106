/**
 * 金额计算：全项目唯一实现（工程契约 R4）
 * 全部使用整数分；顺序固定：商品 → 会员折扣 → 优惠券 → + 运费
 */

export interface AmountLine {
  priceCents: number;
  quantity: number;
}

export interface CouponRule {
  thresholdCents: number;
  faceValueCents: number;
}

export interface FreightRule {
  /** 包邮门槛：按「券后商品金额」判断 */
  freeThresholdCents: number;
  /** 未达门槛时收取的固定运费 */
  flatCents: number;
  /** 命中地区例外时不参与包邮 */
  isExceptionRegion?: boolean;
}

export interface AmountInput {
  items: AmountLine[];
  /** 1 表示无折扣，0.98 / 0.95 为等级折扣 */
  memberDiscountRate?: number;
  coupon?: CouponRule | null;
  freight: FreightRule;
}

export interface OrderAmount {
  goodsCents: number;
  memberDiscountCents: number;
  couponCents: number;
  freightCents: number;
  payableCents: number;
}

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} 必须为非负整数分，收到 ${value}`);
  }
}

export function calculateOrderAmount(input: AmountInput): OrderAmount {
  if (!input.items.length) throw new Error('订单至少需要一件商品');

  const rate = input.memberDiscountRate ?? 1;
  if (!(rate > 0 && rate <= 1)) throw new Error(`会员折扣率非法：${rate}`);

  let goodsCents = 0;
  for (const line of input.items) {
    assertNonNegativeInt(line.priceCents, '商品单价');
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error(`商品数量必须为正整数，收到 ${line.quantity}`);
    }
    goodsCents += line.priceCents * line.quantity;
  }

  // 会员折扣：按比例折算，四舍五入到分
  const memberDiscountCents = goodsCents - Math.round(goodsCents * rate);
  const afterMemberCents = goodsCents - memberDiscountCents;

  // 优惠券：按「会员折扣后金额」判断门槛；最多抵扣到 0 元商品部分
  const couponCents = input.coupon
    ? Math.min(
        Math.max(input.coupon.faceValueCents, 0),
        afterMemberCents >= input.coupon.thresholdCents ? afterMemberCents : 0,
      )
    : 0;

  const afterCouponCents = afterMemberCents - couponCents;

  // 运费：地区例外优先，其次判断包邮门槛（用券后商品金额）
  const freightCents = input.freight.isExceptionRegion
    ? input.freight.flatCents
    : afterCouponCents >= input.freight.freeThresholdCents
      ? 0
      : input.freight.flatCents;

  assertNonNegativeInt(freightCents, '运费');

  return {
    goodsCents,
    memberDiscountCents,
    couponCents,
    freightCents,
    payableCents: afterCouponCents + freightCents,
  };
}

/** 分 → 元字符串，用于展示；不做业务计算 */
export function formatCents(cents: number, withSymbol = true): string {
  const yuan = (cents / 100).toFixed(2);
  return withSymbol ? `¥${yuan}` : yuan;
}

/** 校验订单金额快照自洽：payable = goods - discount - coupon + freight */
export function assertAmountSelfConsistent(amount: OrderAmount): void {
  const expected =
    amount.goodsCents - amount.memberDiscountCents - amount.couponCents + amount.freightCents;
  if (expected !== amount.payableCents) {
    throw new Error(`金额不自洽：期望 ${expected}，实际 ${amount.payableCents}`);
  }
}
