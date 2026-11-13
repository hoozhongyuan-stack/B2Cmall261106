import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  clampPoints,
  nextMemberLevel,
  resolveMemberLevel,
} from '@shanye/shared';

import { PrismaService, type TxClient } from '../../prisma/prisma.module';
import { AssetService } from '../assets/asset.service';

@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetService,
  ) {}

  /**
   * 支付成功入账（同一事务内）：
   * 累计消费 + 实付、积分按 1 元 1 分发放、按新累计消费重算等级。
   */
  async grantForOrder(
    tx: TxClient,
    input: { userId: string; orderId: string; payableCents: number },
  ) {
    const user = await tx.user.update({
      where: { id: input.userId },
      data: { totalSpentCents: { increment: input.payableCents } },
      select: { totalSpentCents: true, points: true, levelId: true },
    });

    // 付费会员卡积分倍率：仅作用于发放，退款按当前倍率扣回
    const card = await tx.memberCard.findFirst({
      where: { userId: input.userId, status: 'ACTIVE', expireAt: { gt: new Date() } },
      orderBy: { expireAt: 'desc' },
    });
    const pointsRate = card?.pointsRate ?? 1;
    const config = await tx.pointsConfig.findUnique({
      where: { id: 'singleton' },
      select: { yuanPerPoint: true },
    });
    const perYuan = Math.max(config?.yuanPerPoint ?? 1, 1);
    const delta = Math.round(Math.floor(input.payableCents / (100 * perYuan)) * pointsRate);
    const balance = user.points + delta;
    if (delta > 0) {
      await tx.user.update({ where: { id: input.userId }, data: { points: balance } });
      await tx.pointsLedger.create({
        data: {
          userId: input.userId,
          delta,
          source: 'ORDER_PAID',
          reason: '订单支付成功',
          orderId: input.orderId,
          balanceAfter: balance,
        },
      });
    }

    const level = resolveMemberLevel(await tx.memberLevel.findMany(), user.totalSpentCents);
    if (level && level.id !== user.levelId) {
      await tx.user.update({ where: { id: input.userId }, data: { levelId: level.id } });
    }

    return { points: delta, balance, levelName: level?.name ?? null };
  }

  /**
   * 退款成功扣回（同一事务内）：
   * 累计消费按退款额扣减（不低于 0）、积分按同口径扣回（余额不为负）、等级随之下调。
   */
  async revokeForRefund(
    tx: TxClient,
    input: { userId: string; orderId: string; refundCents: number },
  ) {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: input.userId },
      select: { totalSpentCents: true, points: true, levelId: true },
    });

    const totalSpentCents = Math.max(user.totalSpentCents - input.refundCents, 0);
    const card = await tx.memberCard.findFirst({
      where: { userId: input.userId, status: 'ACTIVE', expireAt: { gt: new Date() } },
      orderBy: { expireAt: 'desc' },
    });
    const pointsRate = card?.pointsRate ?? 1;
    const config = await tx.pointsConfig.findUnique({
      where: { id: 'singleton' },
      select: { yuanPerPoint: true },
    });
    const perYuan = Math.max(config?.yuanPerPoint ?? 1, 1);
    const { balance, applied } = clampPoints(
      user.points,
      -Math.round(Math.floor(input.refundCents / (100 * perYuan)) * pointsRate),
    );
    const level = resolveMemberLevel(await tx.memberLevel.findMany(), totalSpentCents);

    await tx.user.update({
      where: { id: input.userId },
      data: {
        totalSpentCents,
        points: balance,
        ...(level ? { levelId: level.id } : {}),
      },
    });

    if (applied !== 0) {
      await tx.pointsLedger.create({
        data: {
          userId: input.userId,
          delta: applied,
          source: 'REFUND',
          reason: '订单退款扣回',
          orderId: input.orderId,
          balanceAfter: balance,
        },
      });
    }

    return { points: applied, balance, levelName: level?.name ?? null };
  }

  /** 会员中心：等级、成长值（累计消费）、积分余额与券数量 */
  async profile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { level: true },
    });
    if (!user) throw new NotFoundException('用户不存在');

    const levels = await this.prisma.memberLevel.findMany({ orderBy: { thresholdCents: 'asc' } });
    const current = user.level ?? resolveMemberLevel(levels, user.totalSpentCents);
    const next = nextMemberLevel(levels, user.totalSpentCents);

    const couponCounts = await this.prisma.couponClaim.groupBy({
      by: ['status'],
      where: { userId },
      _count: { _all: true },
    });
    const count = (status: string) =>
      couponCounts.find((c) => c.status === status)?._count._all ?? 0;

    return {
      nickname: user.nickname,
      avatarKey: user.avatarKey,
      points: user.points,
      totalSpentCents: user.totalSpentCents,
      level: current
        ? {
            name: current.name,
            discountRate: current.discountRate,
            thresholdCents: current.thresholdCents,
          }
        : null,
      nextLevel: next
        ? {
            name: next.name,
            thresholdCents: next.thresholdCents,
            remainCents: Math.max(next.thresholdCents - user.totalSpentCents, 0),
          }
        : null,
      coupons: {
        unused: count('UNUSED'),
        used: count('USED'),
        expired: count('EXPIRED'),
      },
    };
  }

  /** 个人资料：昵称与头像维护（头像必须来自素材库） */
  async updateProfile(
    userId: string,
    input: { nickname?: string; avatarKey?: string | null },
  ) {
    const data: { nickname?: string; avatarKey?: string | null } = {};

    if (input.nickname !== undefined) {
      const nickname = input.nickname.trim();
      if (!nickname) throw new BadRequestException('昵称不能为空');
      if (nickname.length > 20) throw new BadRequestException('昵称不能超过 20 个字符');
      data.nickname = nickname;
    }

    if (input.avatarKey !== undefined) {
      const key = (input.avatarKey ?? '').trim();
      await this.assets.assertReference(key);
      data.avatarKey = key || null;
    }

    if (!Object.keys(data).length) throw new BadRequestException('没有需要保存的内容');

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: { nickname: true, avatarKey: true },
    });
    return user;
  }

  async ledger(userId: string, take = 50) {
    const [items, user] = await Promise.all([
      this.prisma.pointsLedger.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
    ]);
    return {
      balance: user?.points ?? 0,
      items: items.map((i) => ({
        id: i.id,
        delta: i.delta,
        source: i.source,
        reason: i.reason,
        orderId: i.orderId,
        balanceAfter: i.balanceAfter,
        createdAt: i.createdAt,
      })),
    };
  }

  /** 后台手动调整积分：记流水，余额不允许为负 */
  async adjustPoints(userId: string, delta: number, reason: string) {
    if (!Number.isInteger(delta) || delta === 0) {
      throw new BadRequestException('积分变动必须为非零整数');
    }
    if (!reason?.trim()) throw new BadRequestException('请填写调整原因');

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { points: true } });
      if (!user) throw new NotFoundException('客户不存在');

      const { balance, applied } = clampPoints(user.points, delta);
      if (applied === 0) throw new ConflictException('积分余额已为 0，无法继续扣减');

      await tx.user.update({ where: { id: userId }, data: { points: balance } });
      await tx.pointsLedger.create({
        data: { userId, delta: applied, source: 'ADMIN', reason, balanceAfter: balance },
      });
      return { balance, delta: applied };
    });
  }

  /* ---------------- 等级规则（后台） ---------------- */

  listLevels() {
    return this.prisma.memberLevel.findMany({
      orderBy: { thresholdCents: 'asc' },
      include: { _count: { select: { users: true } } },
    });
  }

  async createLevel(input: { name: string; thresholdCents: number; discountRate: number }) {
    this.assertLevel(input);
    return this.prisma.memberLevel.create({ data: input });
  }

  async updateLevel(
    id: string,
    input: { name?: string; thresholdCents?: number; discountRate?: number },
  ) {
    const level = await this.prisma.memberLevel.findUnique({ where: { id } });
    if (!level) throw new NotFoundException('等级不存在');

    const merged = {
      name: input.name ?? level.name,
      thresholdCents: input.thresholdCents ?? level.thresholdCents,
      discountRate: input.discountRate ?? level.discountRate,
    };
    this.assertLevel(merged);
    return this.prisma.memberLevel.update({ where: { id }, data: merged });
  }

  private assertLevel(input: {
    name: string;
    thresholdCents: number;
    discountRate: number;
  }): void {
    if (!input.name?.trim()) throw new BadRequestException('等级名称不能为空');
    if (!Number.isInteger(input.thresholdCents) || input.thresholdCents < 0) {
      throw new BadRequestException('升级门槛必须为非负整数分');
    }
    if (!(input.discountRate > 0) || input.discountRate > 1) {
      throw new BadRequestException('折扣率必须在 0 与 1 之间（1 表示不打折）');
    }
  }
}
