import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { couponClaimState, type CouponClaimState } from '@shanye/shared';

import { PrismaService, type TxClient } from '../../prisma/prisma.module';

export interface CreateCouponInput {
  name: string;
  thresholdCents?: number;
  faceValueCents: number;
  total: number;
  perLimit?: number;
  channel?: string;
  startAt: string;
  endAt: string;
}

@Injectable()
export class CouponService {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------- 小程序 ---------------- */

  /** 领券中心：仅展示发放中且未领完的券，并带上「我已领 / 剩余」 */
  async listClaimable(userId: string) {
    const now = new Date();
    const coupons = await this.prisma.coupon.findMany({
      where: { enabled: true, startAt: { lte: now }, endAt: { gte: now } },
      orderBy: [{ thresholdCents: 'asc' }, { createdAt: 'desc' }],
    });
    const mine = await this.prisma.couponClaim.groupBy({
      by: ['couponId'],
      where: { userId, couponId: { in: coupons.map((c) => c.id) } },
      _count: { _all: true },
    });
    const mineMap = new Map(mine.map((m) => [m.couponId, m._count._all]));

    return {
      items: coupons.map((coupon) => {
        const claimedByMe = mineMap.get(coupon.id) ?? 0;
        const remaining = Math.max(coupon.total - coupon.claimed, 0);
        return {
          id: coupon.id,
          name: coupon.name,
          type: coupon.type,
          thresholdCents: coupon.thresholdCents,
          faceValueCents: coupon.faceValueCents,
          startAt: coupon.startAt,
          endAt: coupon.endAt,
          remaining,
          claimedByMe,
          perLimit: coupon.perLimit,
          canClaim: remaining > 0 && claimedByMe < coupon.perLimit,
        };
      }),
    };
  }

  async claim(userId: string, couponId: string) {
    return this.prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon.findUnique({ where: { id: couponId } });
      if (!coupon) throw new NotFoundException('优惠券不存在');
      return this.claimInTx(tx, coupon, userId);
    });
  }

  async listMine(userId: string, status?: CouponClaimState) {
    // 惰性过期：读列表前把已过期的未使用券置为 EXPIRED，避免展示口径不一致
    await this.prisma.couponClaim.updateMany({
      where: { userId, status: 'UNUSED', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });

    const claims = await this.prisma.couponClaim.findMany({
      where: { userId, ...(status ? { status } : {}) },
      include: { coupon: true },
      orderBy: [{ status: 'asc' }, { expiresAt: 'asc' }],
      take: 100,
    });
    const counts = await this.prisma.couponClaim.groupBy({
      by: ['status'],
      where: { userId },
      _count: { _all: true },
    });

    return {
      counts: counts.map((c) => ({ status: c.status, count: c._count._all })),
      items: claims.map((c) => ({
        id: c.id,
        couponId: c.couponId,
        name: c.coupon.name,
        type: c.coupon.type,
        thresholdCents: c.coupon.thresholdCents,
        faceValueCents: c.coupon.faceValueCents,
        status: couponClaimState({ status: c.status, expiresAt: c.expiresAt }),
        expiresAt: c.expiresAt,
        usedAt: c.usedAt,
      })),
    };
  }

  /**
   * 订单取消 / 整单退款时退回优惠券：
   * 仍在有效期则回到 UNUSED，已过期则置 EXPIRED（不再可用）。
   */
  async releaseForOrder(tx: TxClient, orderId: string) {
    const claim = await tx.couponClaim.findFirst({ where: { orderId, status: 'USED' } });
    if (!claim) return null;

    const expired = claim.expiresAt.getTime() <= Date.now();
    await tx.couponClaim.update({
      where: { id: claim.id },
      data: {
        status: expired ? 'EXPIRED' : 'UNUSED',
        orderId: null,
        usedAt: null,
      },
    });
    return { claimId: claim.id, returned: !expired };
  }

  /* ---------------- 后台 ---------------- */

  async listAdmin() {
    const coupons = await this.prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { _count: { select: { claims: true } } },
    });
    return {
      items: coupons.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        thresholdCents: c.thresholdCents,
        faceValueCents: c.faceValueCents,
        total: c.total,
        claimed: c.claimed,
        perLimit: c.perLimit,
        channel: c.channel,
        startAt: c.startAt,
        endAt: c.endAt,
        enabled: c.enabled,
        usedCount: c._count.claims,
      })),
    };
  }

  async createAdmin(input: CreateCouponInput) {
    if (!Number.isInteger(input.faceValueCents) || input.faceValueCents <= 0) {
      throw new BadRequestException('券面额必须为正整数分');
    }
    if (!Number.isInteger(input.total) || input.total <= 0) {
      throw new BadRequestException('发放总量必须为正整数');
    }
    const thresholdCents = input.thresholdCents ?? 0;
    if (thresholdCents < 0) {
      throw new BadRequestException('使用门槛不能为负数');
    }
    // 满减券门槛低于面额会造成 0 元购；无门槛券（门槛 0）不受此限制
    if (thresholdCents > 0 && thresholdCents < input.faceValueCents) {
      throw new BadRequestException('使用门槛不得低于券面额');
    }
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt >= endAt) {
      throw new BadRequestException('有效期区间不合法');
    }

    return this.prisma.coupon.create({
      data: {
        name: input.name,
        type: thresholdCents > 0 ? 'THRESHOLD' : 'NO_THRESHOLD',
        thresholdCents,
        faceValueCents: input.faceValueCents,
        total: input.total,
        perLimit: input.perLimit ?? 1,
        channel: input.channel ?? 'MINIAPP',
        startAt,
        endAt,
      },
    });
  }

  async toggleAdmin(id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException('优惠券不存在');
    return this.prisma.coupon.update({
      where: { id },
      data: { enabled: !coupon.enabled },
    });
  }

  /** 后台发放：指定客户或全部客户；已超限/已领完的逐条跳过，返回发放结果 */
  async grantAdmin(id: string, input: { userIds?: string[]; all?: boolean }) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException('优惠券不存在');

    const targets = input.all
      ? (await this.prisma.user.findMany({ select: { id: true }, take: 200 })).map((u) => u.id)
      : (input.userIds ?? []);
    if (!targets.length) throw new BadRequestException('请选择发放对象');

    const granted: string[] = [];
    const skipped: { userId: string; reason: string }[] = [];

    for (const userId of targets) {
      try {
        await this.prisma.$transaction((tx) => this.claimInTx(tx, coupon, userId));
        granted.push(userId);
      } catch (err) {
        skipped.push({
          userId,
          reason: err instanceof Error ? err.message : '发放失败',
        });
      }
    }

    return { granted: granted.length, skipped };
  }

  async claimsAdmin(couponId: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) throw new NotFoundException('优惠券不存在');

    const claims = await this.prisma.couponClaim.findMany({
      where: { couponId },
      include: { user: { select: { id: true, nickname: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return {
      coupon: { id: coupon.id, name: coupon.name, total: coupon.total, claimed: coupon.claimed },
      items: claims.map((c) => ({
        id: c.id,
        status: c.status,
        createdAt: c.createdAt,
        usedAt: c.usedAt,
        expiresAt: c.expiresAt,
        customer: { id: c.user.id, nickname: c.user.nickname, phone: c.user.phone },
      })),
    };
  }

  /* ---------------- 内部 ---------------- */

  /**
   * 领取的原子实现：
   * 1) 单条 SQL 内比较 claimed < total 扣减库存，避免读改写竞态；
   * 2) 同一事务内二次校验每人限领，任一失败整笔回滚。
   */
  private async claimInTx(
    tx: TxClient,
    coupon: {
      id: string;
      enabled: boolean;
      startAt: Date;
      endAt: Date;
      perLimit: number;
    },
    userId: string,
  ) {
    const now = new Date();
    if (!coupon.enabled) throw new ConflictException('优惠券已停止发放');
    if (now < coupon.startAt) throw new ConflictException('优惠券还未开始发放');
    if (now > coupon.endAt) throw new ConflictException('优惠券已过期');

    const updated = await tx.$executeRaw`
      UPDATE "Coupon" SET "claimed" = "claimed" + 1
      WHERE "id" = ${coupon.id} AND "claimed" < "total"`;
    if (updated !== 1) throw new ConflictException('优惠券已领完');

    const owned = await tx.couponClaim.count({ where: { couponId: coupon.id, userId } });
    if (owned >= coupon.perLimit) throw new ConflictException('已达每人限领张数');

    return tx.couponClaim.create({
      data: { couponId: coupon.id, userId, status: 'UNUSED', expiresAt: coupon.endAt },
    });
  }
}
