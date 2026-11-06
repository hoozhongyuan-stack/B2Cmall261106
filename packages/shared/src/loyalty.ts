/**
 * 会员、积分、优惠券与评价的共享规则（工程契约 R4）
 * 后台、小程序与服务端共用同一份口径，避免各页面自行解释阈值与折算。
 */

export interface MemberLevelRule {
  name: string;
  thresholdCents: number;
  discountRate: number;
}

/** 按累计消费匹配等级：取已达到的最高门槛；同门槛取折扣更低（对用户更有利）的一档 */
export function resolveMemberLevel<T extends MemberLevelRule>(
  levels: T[],
  totalSpentCents: number,
): T | null {
  let hit: T | null = null;
  for (const level of levels) {
    if (level.thresholdCents > totalSpentCents) continue;
    const better =
      !hit ||
      level.thresholdCents > hit.thresholdCents ||
      (level.thresholdCents === hit.thresholdCents && level.discountRate < hit.discountRate);
    if (better) hit = level;
  }
  return hit;
}

/** 下一个待解锁等级：按门槛升序取第一个尚未达到的档位 */
export function nextMemberLevel<T extends MemberLevelRule>(
  levels: T[],
  totalSpentCents: number,
): T | null {
  const upcoming = levels
    .filter((level) => level.thresholdCents > totalSpentCents)
    .sort((a, b) => a.thresholdCents - b.thresholdCents);
  return upcoming[0] ?? null;
}

/** 积分折算：实付每 1 元计 1 分，向下取整；退款按同一口径扣回 */
export const POINTS_PER_YUAN = 1;

export function pointsForAmount(amountCents: number): number {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return 0;
  return Math.floor((amountCents * POINTS_PER_YUAN) / 100);
}

/** 扣减积分不允许出现负余额，返回最终余额与实际变动值 */
export function clampPoints(
  current: number,
  delta: number,
): { balance: number; applied: number } {
  const balance = Math.max(current + delta, 0);
  return { balance, applied: balance - current };
}

/* ---------------- 优惠券 ---------------- */

export type CouponClaimState = 'UNUSED' | 'USED' | 'EXPIRED';

/** 已使用优先；未使用则按有效期判定是否过期 */
export function couponClaimState(
  claim: { status: CouponClaimState; expiresAt: Date | string },
  now: Date = new Date(),
): CouponClaimState {
  if (claim.status === 'USED') return 'USED';
  return new Date(claim.expiresAt).getTime() <= now.getTime() ? 'EXPIRED' : 'UNUSED';
}

/* ---------------- 评价 ---------------- */

export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;

export function isValidRating(rating: number): boolean {
  return Number.isInteger(rating) && rating >= REVIEW_RATING_MIN && rating <= REVIEW_RATING_MAX;
}

/** 商品评价摘要平均分：保留 1 位小数 */
export function averageRating(ratings: number[]): number {
  if (!ratings.length) return 0;
  const sum = ratings.reduce((acc, r) => acc + r, 0);
  return Math.round((sum / ratings.length) * 10) / 10;
}
