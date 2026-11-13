import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.module';

const WEEK_DAYS = 7;

function startOfLocalDay(base: Date, offsetDays = 0): Date {
  const date = new Date(base);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date;
}

function localDateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const now = new Date();
    const todayStart = startOfLocalDay(now);
    const yesterdayStart = startOfLocalDay(now, -1);
    const weekStart = startOfLocalDay(now, -(WEEK_DAYS - 1));

    const [
      paidOrderCount,
      paidAmountAgg,
      refundedAgg,
      newCustomerCount,
      yesterdayPaidOrderCount,
      yesterdayPaidAmountAgg,
      yesterdayRefundedAgg,
      yesterdayNewCustomerCount,
      toShipCount,
      afterSaleCount,
      pendingReviewCount,
      weekOrders,
      weekOrderItems,
    ] = await Promise.all([
      this.prisma.order.count({ where: { paidAt: { gte: todayStart } } }),
      this.prisma.order.aggregate({
        where: { paidAt: { gte: todayStart } },
        _sum: { payableCents: true },
      }),
      this.prisma.refund.aggregate({
        where: { status: 'SUCCESS', refundedAt: { gte: todayStart } },
        _sum: { amountCents: true },
      }),
      this.prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      this.prisma.order.count({
        where: { paidAt: { gte: yesterdayStart, lt: todayStart } },
      }),
      this.prisma.order.aggregate({
        where: { paidAt: { gte: yesterdayStart, lt: todayStart } },
        _sum: { payableCents: true },
      }),
      this.prisma.refund.aggregate({
        where: {
          status: 'SUCCESS',
          refundedAt: { gte: yesterdayStart, lt: todayStart },
        },
        _sum: { amountCents: true },
      }),
      this.prisma.user.count({
        where: { createdAt: { gte: yesterdayStart, lt: todayStart } },
      }),
      this.prisma.order.count({ where: { status: 'PAID' } }),
      this.prisma.afterSale.count({ where: { status: { in: ['APPLIED', 'WAIT_SELLER_RECEIVE'] } } }),
      this.prisma.review.count({ where: { status: 'PENDING' } }),
      this.prisma.order.findMany({
        where: { paidAt: { gte: weekStart } },
        select: { paidAt: true, payableCents: true },
      }),
      this.prisma.orderItem.findMany({
        where: { order: { paidAt: { gte: weekStart } } },
        select: {
          title: true,
          quantity: true,
          paidCents: true,
          sku: { select: { productId: true } },
        },
      }),
    ]);

    const trendMap = new Map<string, { date: string; orderCount: number; paidAmountCents: number }>();
    for (let i = 0; i < WEEK_DAYS; i += 1) {
      const date = startOfLocalDay(now, -(WEEK_DAYS - 1 - i));
      const key = localDateKey(date);
      trendMap.set(key, { date: key, orderCount: 0, paidAmountCents: 0 });
    }
    for (const order of weekOrders) {
      if (!order.paidAt) continue;
      const bucket = trendMap.get(localDateKey(order.paidAt));
      if (!bucket) continue;
      bucket.orderCount += 1;
      bucket.paidAmountCents += order.payableCents;
    }

    const productMap = new Map<
      string,
      { productId: string; title: string; quantity: number; amountCents: number }
    >();
    for (const item of weekOrderItems) {
      const productId = item.sku.productId;
      const bucket = productMap.get(productId) ?? {
        productId,
        title: item.title,
        quantity: 0,
        amountCents: 0,
      };
      bucket.quantity += item.quantity;
      bucket.amountCents += item.paidCents;
      productMap.set(productId, bucket);
    }
    const topProducts = [...productMap.values()]
      .sort((a, b) => b.quantity - a.quantity || b.amountCents - a.amountCents)
      .slice(0, 5);

    return {
      today: {
        paidOrderCount,
        paidAmountCents: paidAmountAgg._sum.payableCents ?? 0,
        refundedCents: refundedAgg._sum.amountCents ?? 0,
        newCustomerCount,
      },
      yesterday: {
        paidOrderCount: yesterdayPaidOrderCount,
        paidAmountCents: yesterdayPaidAmountAgg._sum.payableCents ?? 0,
        refundedCents: yesterdayRefundedAgg._sum.amountCents ?? 0,
        newCustomerCount: yesterdayNewCustomerCount,
      },
      pending: { toShipCount, afterSaleCount, pendingReviewCount },
      trend: [...trendMap.values()],
      topProducts,
    };
  }
}
