/**
 * 金额计算：全项目唯一实现（工程契约 R4）
 * 全部使用整数分；顺序固定：商品 → 会员折扣 → 优惠券 → + 运费
 */

export interface AmountLine {
  priceCents: number;
  quantity: number;
  /** 秒杀行：不参与会员折扣、优惠券与满减 */
  seckill?: boolean;
}

export interface CouponRule {
  thresholdCents: number;
  faceValueCents: number;
}

/** 满减规则：门槛按「券后普通商品金额」判断 */
export interface FullReductionRule {
  thresholdCents: number;
  discountCents: number;
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
  /** 1 表示无折扣，0.98 / 0.95 为等级折扣；仅作用于非秒杀商品 */
  memberDiscountRate?: number;
  coupon?: CouponRule | null;
  /** 满减：在优惠券之后，按券后普通商品金额判断门槛 */
  fullReduction?: FullReductionRule | null;
  freight: FreightRule;
}

export interface OrderAmount {
  goodsCents: number;
  memberDiscountCents: number;
  couponCents: number;
  fullReductionCents: number;
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
  let normalGoodsCents = 0;
  for (const line of input.items) {
    assertNonNegativeInt(line.priceCents, '商品单价');
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error(`商品数量必须为正整数，收到 ${line.quantity}`);
    }
    const subtotal = line.priceCents * line.quantity;
    goodsCents += subtotal;
    if (!line.seckill) normalGoodsCents += subtotal;
  }

  // 会员折扣：仅作用于非秒杀商品，按比例折算，四舍五入到分
  const memberDiscountCents = normalGoodsCents - Math.round(normalGoodsCents * rate);
  const afterMemberCents = goodsCents - memberDiscountCents;

  // 优惠券：只抵扣普通商品（秒杀行不参与），按会员折扣后普通商品金额判断门槛
  const afterMemberNormalCents = normalGoodsCents - memberDiscountCents;
  const couponCents = input.coupon
    ? Math.min(
        Math.max(input.coupon.faceValueCents, 0),
        afterMemberNormalCents >= input.coupon.thresholdCents ? afterMemberNormalCents : 0,
      )
    : 0;

  const afterCouponCents = afterMemberCents - couponCents;

  // 满减：券后普通商品金额判断门槛，最多抵扣普通商品部分
  const normalAfterCouponCents = afterMemberNormalCents - couponCents;
  const fullReductionCents =
    input.fullReduction && normalAfterCouponCents >= input.fullReduction.thresholdCents
      ? Math.min(Math.max(input.fullReduction.discountCents, 0), normalAfterCouponCents)
      : 0;

  const afterReductionCents = afterCouponCents - fullReductionCents;

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
    fullReductionCents,
    freightCents,
    payableCents: afterReductionCents + freightCents,
  };
}

/** 分 → 元字符串，用于展示；不做业务计算 */
export function formatCents(cents: number, withSymbol = true): string {
  const yuan = (cents / 100).toFixed(2);
  return withSymbol ? `¥${yuan}` : yuan;
}

/** 校验订单金额快照自洽：payable = goods - discount - coupon - 满减 + freight */
export function assertAmountSelfConsistent(amount: OrderAmount): void {
  const expected =
    amount.goodsCents -
    amount.memberDiscountCents -
    amount.couponCents -
    amount.fullReductionCents +
    amount.freightCents;
  if (expected !== amount.payableCents) {
    throw new Error(`金额不自洽：期望 ${expected}，实际 ${amount.payableCents}`);
  }
}

/**
 * 把整单优惠按商品金额占比分摊到行（用于订单行实付与退款上限）。
 * 余数给最后一行，保证分摊合计精确等于总优惠。
 */
export function allocateDiscount(totalDiscountCents: number, weightsCents: number[]): number[] {
  if (!weightsCents.length) return [];
  if (totalDiscountCents <= 0) return weightsCents.map(() => 0);

  const sum = weightsCents.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weightsCents.map(() => 0);

  const result = weightsCents.map((w) => Math.floor((totalDiscountCents * w) / sum));
  const allocated = result.reduce((a, b) => a + b, 0);
  const rest = totalDiscountCents - allocated;
  if (rest > 0) result[result.length - 1] += rest;
  return result;
}

/** 计算每行实付（不含运费），返回与输入等长的数组；秒杀行不参与任何优惠 */
export function allocateLinePaidCents(input: {
  lines: AmountLine[];
  memberDiscountCents: number;
  couponCents: number;
  fullReductionCents?: number;
}): number[] {
  const goods = input.lines.map((l) => l.priceCents * l.quantity);
  // 秒杀行权重为 0，优惠只摊到普通商品
  const weights = input.lines.map((l, i) => (l.seckill ? 0 : goods[i]));
  const memberAlloc = allocateDiscount(input.memberDiscountCents, weights);
  const couponAlloc = allocateDiscount(input.couponCents, weights);
  const fullAlloc = allocateDiscount(input.fullReductionCents ?? 0, weights);
  return goods.map((g, i) => g - memberAlloc[i] - couponAlloc[i] - fullAlloc[i]);
}
