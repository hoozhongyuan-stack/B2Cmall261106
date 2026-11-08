import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.module';

/** 已支付口径：有支付时间且未关闭 */
const PAID_STATUS = ['PENDING_PAYMENT', 'CLOSED'];

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 经营看板：活动效果、会员贡献、复购与商品排行 */
  async overview(days = 30) {
    const rangeDays = Math.min(Math.max(days, 1), 365);
    const since = new Date(Date.now() - rangeDays * 86_400_000);
    const paidWhere = {
      paidAt: { gte: since },
      status: { notIn: PAID_STATUS as never[] },
    };

    const [totals, fullReduction, memberOrders, seckill, repurchaseRows, topProducts, cardCount, rechargeSum] =
      await Promise.all([
        this.prisma.order.aggregate({
          where: paidWhere,
          _count: { _all: true },
          _sum: { payableCents: true, memberDiscountCents: true, fullReductionCents: true },
        }),
        this.prisma.order.aggregate({
          where: { ...paidWhere, fullReductionCents: { gt: 0 } },
          _count: { _all: true },
          _sum: { fullReductionCents: true },
        }),
        this.prisma.order.aggregate({
          where: { ...paidWhere, memberDiscountCents: { gt: 0 } },
          _count: { _all: true },
          _sum: { payableCents: true },
        }),
        this.prisma.orderItem.aggregate({
          where: { isSeckill: true, order: paidWhere },
          _count: { _all: true },
          _sum: { quantity: true, paidCents: true },
        }),
        this.prisma.order.groupBy({
          by: ['userId'],
          where: paidWhere,
          _count: { _all: true },
        }),
        this.prisma.orderItem.groupBy({
          by: ['title'],
          where: { order: paidWhere },
          _sum: { quantity: true, paidCents: true },
          orderBy: { _sum: { quantity: 'desc' } },
          take: 10,
        }),
        this.prisma.memberCard.count({ where: { createdAt: { gte: since } } }),
        this.prisma.rechargeOrder.aggregate({
          where: { createdAt: { gte: since }, status: 'PAID' },
          _sum: { amountCents: true },
        }),
      ]);

    const paidOrders = totals._count._all;
    const buyers = repurchaseRows.length;
    const repeatBuyers = repurchaseRows.filter((row) => row._count._all >= 2).length;

    return {
      range: { days: rangeDays, since },
      overview: {
        paidOrders,
        gmvCents: totals._sum.payableCents ?? 0,
        memberDiscountCents: totals._sum.memberDiscountCents ?? 0,
        fullReductionCents: totals._sum.fullReductionCents ?? 0,
        avgOrderCents: paidOrders
          ? Math.round((totals._sum.payableCents ?? 0) / paidOrders)
          : 0,
      },
      activity: {
        fullReductionOrders: fullReduction._count._all,
        fullReductionCents: fullReduction._sum.fullReductionCents ?? 0,
        seckillItems: seckill._count._all,
        seckillQuantity: seckill._sum.quantity ?? 0,
        seckillSalesCents: seckill._sum.paidCents ?? 0,
      },
      member: {
        ordersWithDiscount: memberOrders._count._all,
        gmvCents: memberOrders._sum.payableCents ?? 0,
        cardPurchases: cardCount,
        rechargeCents: rechargeSum._sum.amountCents ?? 0,
      },
      repurchase: {
        buyers,
        repeatBuyers,
        repeatRate: buyers ? Number(((repeatBuyers / buyers) * 100).toFixed(1)) : 0,
      },
      topProducts: topProducts.map((row) => ({
        title: row.title,
        quantity: row._sum.quantity ?? 0,
        salesCents: row._sum.paidCents ?? 0,
      })),
    };
  }
}
