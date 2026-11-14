import { Injectable, NotFoundException } from '@nestjs/common';
import { nextMemberLevel, resolveMemberLevel } from '@shanye/shared';

import { PrismaService } from '../../prisma/prisma.module';

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  /** 客户列表：订单数、实付、退款与最近下单时间一次性聚合（分页），支持按标签筛选 */
  async list(input: {
    keyword?: string;
    levelId?: string;
    tagId?: string;
    startDate?: string;
    endDate?: string;
    minSpentCents?: number;
    maxSpentCents?: number;
    page?: number;
    pageSize?: number;
  }) {
    const currentPage = Math.max(input.page ?? 1, 1);
    const size = Math.min(Math.max(input.pageSize ?? 20, 1), 100);

    let tagIds: string[] = [];
    if (input.tagId) {
      const children = await this.prisma.userTag.findMany({
        where: { parentId: input.tagId },
        select: { id: true },
      });
      tagIds = [input.tagId, ...children.map((item) => item.id)];
    }

    const createdAt =
      input.startDate || input.endDate
        ? {
            ...(input.startDate
              ? { gte: new Date(`${input.startDate}T00:00:00.000+08:00`) }
              : {}),
            ...(input.endDate
              ? { lte: new Date(`${input.endDate}T23:59:59.999+08:00`) }
              : {}),
          }
        : undefined;

    const where = {
      ...(input.levelId ? { levelId: input.levelId } : {}),
      ...(tagIds.length ? { tags: { some: { tagId: { in: tagIds } } } } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(input.minSpentCents !== undefined || input.maxSpentCents !== undefined
        ? {
            totalSpentCents: {
              ...(input.minSpentCents !== undefined ? { gte: input.minSpentCents } : {}),
              ...(input.maxSpentCents !== undefined ? { lte: input.maxSpentCents } : {}),
            },
          }
        : {}),
      ...(input.keyword
        ? {
            OR: [
              { nickname: { contains: input.keyword, mode: 'insensitive' as const } },
              { phone: { contains: input.keyword } },
              { openid: { contains: input.keyword } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: {
          level: true,
          tags: { include: { tag: { include: { parent: { select: { name: true } } } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (currentPage - 1) * size,
        take: size,
      }),
      this.prisma.user.count({ where }),
    ]);

    const stats = await this.prisma.order.groupBy({
      by: ['userId'],
      where: { userId: { in: users.map((u) => u.id) } },
      _sum: { payableCents: true, refundedCents: true },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    const byUser = new Map(stats.map((s) => [s.userId, s]));

    return {
      total,
      page: currentPage,
      pageSize: size,
      items: users.map((u) => {
        const stat = byUser.get(u.id);
        const paidCents = stat?._sum.payableCents ?? 0;
        const refundedCents = stat?._sum.refundedCents ?? 0;
        return {
          id: u.id,
          nickname: u.nickname,
          phone: u.phone,
          avatarKey: u.avatarKey,
          levelName: u.level?.name ?? null,
          points: u.points,
          totalSpentCents: u.totalSpentCents,
          orderCount: stat?._count._all ?? 0,
          paidCents,
          refundedCents,
          netCents: paidCents - refundedCents,
          lastOrderAt: stat?._max.createdAt ?? null,
          createdAt: u.createdAt,
          tags: u.tags.map((link) => ({
            id: link.tag.id,
            name: link.tag.name,
            parentId: link.tag.parentId,
            parentName: link.tag.parent?.name ?? null,
          })),
        };
      }),
    };
  }

  /** 客户详情：资产、消费统计、最近订单与积分流水 */
  async detail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        level: true,
        tags: { include: { tag: { include: { parent: { select: { name: true } } } } } },
      },
    });
    if (!user) throw new NotFoundException('客户不存在');

    const [agg, orders, ledger, levels, couponClaims] = await Promise.all([
      this.prisma.order.aggregate({
        where: { userId: id, status: { not: 'CLOSED' } },
        _sum: { payableCents: true, refundedCents: true },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      this.prisma.order.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { items: { select: { title: true, quantity: true } } },
      }),
      this.prisma.pointsLedger.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.memberLevel.findMany({ orderBy: { thresholdCents: 'asc' } }),
      this.prisma.couponClaim.groupBy({
        by: ['status'],
        where: { userId: id },
        _count: { _all: true },
      }),
    ]);

    const paidCents = agg._sum.payableCents ?? 0;
    const refundedCents = agg._sum.refundedCents ?? 0;
    const current = user.level ?? resolveMemberLevel(levels, user.totalSpentCents);
    const next = nextMemberLevel(levels, user.totalSpentCents);

    return {
      id: user.id,
      nickname: user.nickname,
      phone: user.phone,
      avatarKey: user.avatarKey,
      openid: user.openid,
      createdAt: user.createdAt,
      points: user.points,
      totalSpentCents: user.totalSpentCents,
      tags: user.tags.map((link) => ({
        id: link.tag.id,
        name: link.tag.name,
        parentId: link.tag.parentId,
        parentName: link.tag.parent?.name ?? null,
      })),
      level: current
        ? { name: current.name, discountRate: current.discountRate, thresholdCents: current.thresholdCents }
        : null,
      nextLevel: next
        ? {
            name: next.name,
            thresholdCents: next.thresholdCents,
            remainCents: Math.max(next.thresholdCents - user.totalSpentCents, 0),
          }
        : null,
      stats: {
        orderCount: agg._count._all,
        paidCents,
        refundedCents,
        netCents: paidCents - refundedCents,
        lastOrderAt: agg._max.createdAt,
      },
      coupons: couponClaims.map((c) => ({ status: c.status, count: c._count._all })),
      recentOrders: orders.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        status: o.status,
        payableCents: o.payableCents,
        createdAt: o.createdAt,
        itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
        firstItemTitle: o.items[0]?.title ?? '',
      })),
      recentPoints: ledger.map((l) => ({
        id: l.id,
        delta: l.delta,
        source: l.source,
        reason: l.reason,
        balanceAfter: l.balanceAfter,
        createdAt: l.createdAt,
      })),
    };
  }

  /** 后台批量发放会员卡：不扣储值，直接按方案生成权益快照 */
  async grantMemberCards(userIds: string[], planId: string) {
    const plan = await this.prisma.memberCardPlan.findUnique({ where: { id: planId } });
    if (!plan || !plan.enabled) throw new NotFoundException('会员卡方案不存在或已下架');

    const targets = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true },
    });
    const valid = new Set(targets.map((user) => user.id));
    const granted: string[] = [];
    const skipped: { userId: string; reason: string }[] = [];

    for (const userId of userIds) {
      if (!valid.has(userId)) {
        skipped.push({ userId, reason: '客户不存在' });
        continue;
      }
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.memberCard.updateMany({
          where: { userId, status: 'ACTIVE', expireAt: { gt: now } },
          data: { status: 'REPLACED' },
        });
        await tx.memberCard.create({
          data: {
            userId,
            planId: plan.id,
            planName: plan.name,
            discountRate: plan.discountRate,
            pointsRate: plan.pointsRate,
            freeShipping: plan.freeShipping,
            startAt: now,
            expireAt: new Date(now.getTime() + plan.durationDays * 86_400_000),
            status: 'ACTIVE',
          },
        });
      });
      granted.push(userId);
    }

    return { granted: granted.length, skipped };
  }

  /** 后台调整会员等级：levelId 为空表示清除人工等级 */
  async setLevels(userIds: string[], levelId: string | null) {
    if (levelId) {
      const level = await this.prisma.memberLevel.findUnique({ where: { id: levelId } });
      if (!level) throw new NotFoundException('会员等级不存在');
    }
    const result = await this.prisma.user.updateMany({
      where: { id: { in: [...new Set(userIds)] } },
      data: { levelId: levelId || null },
    });
    return { updated: result.count };
  }
}
