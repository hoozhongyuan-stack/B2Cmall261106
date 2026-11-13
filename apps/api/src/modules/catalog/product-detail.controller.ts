import { Controller, Get, Param, NotFoundException, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../../prisma/prisma.module';
import {
  OptionalCurrentUser,
  OptionalUserJwtGuard,
  type MiniappUser,
} from '../../common/user-auth.guard';

@ApiTags('catalog')
@Controller('products')
export class ProductDetailController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  @UseGuards(OptionalUserJwtGuard)
  @ApiOperation({ summary: '商品详情：SKU、标签、评价摘要与会员卡权益' })
  async detail(@Param('id') id: string, @OptionalCurrentUser() user?: MiniappUser) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        skus: { orderBy: { priceCents: 'asc' } },
        tags: true,
        category: true,
      },
    });
    if (!product) throw new NotFoundException('商品不存在或已下架');

    const [reviews, reviewAgg, seckillRows, memberCard] = await Promise.all([
      this.prisma.review.findMany({
        where: { status: 'SHOWN', orderItem: { sku: { productId: id } } },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }),
      this.prisma.review.aggregate({
        where: { status: 'SHOWN', orderItem: { sku: { productId: id } } },
        _count: { _all: true },
        _avg: { rating: true },
      }),
      this.prisma.seckillSku.findMany({
        where: {
          skuId: { in: product.skus.map((sku) => sku.id) },
          promotion: {
            type: 'SECKILL',
            enabled: true,
            startAt: { lte: new Date() },
            endAt: { gte: new Date() },
          },
        },
        include: { promotion: true },
      }),
      this.memberCardBenefit(user?.sub),
    ]);

    const seckillMap = new Map<
      string,
      {
        promotionName: string;
        priceCents: number;
        stockLeft: number;
        limitPerUser: number;
      }
    >();
    for (const row of seckillRows) {
      const stockLeft = row.stock - row.sold;
      if (stockLeft <= 0) continue;
      const current = seckillMap.get(row.skuId);
      if (current && current.priceCents <= row.seckillPriceCents) continue;
      seckillMap.set(row.skuId, {
        promotionName: row.promotion.name,
        priceCents: row.seckillPriceCents,
        stockLeft,
        limitPerUser: row.limitPerUser,
      });
    }

    return {
      id: product.id,
      title: product.title,
      subtitle: product.subtitle,
      detail: product.detail,
      mainImageKey: product.mainImageKey,
      mainImageKeys:
        product.mainImageKeys.length > 0
          ? product.mainImageKeys
          : product.mainImageKey
            ? [product.mainImageKey]
            : [],
      detailImageKeys: product.detailImageKeys,
      status: product.status,
      channel: product.channel,
      pointsLimitPerUser: product.pointsLimitPerUser,
      category: product.category.name,
      tags: product.tags.map((t) => t.name),
      skus: product.skus.map((s) => ({
        id: s.id,
        spec: s.specJson,
        priceCents: s.priceCents,
        originCents: s.originCents,
        pointsCost: s.pointsCost,
        pointsMoneyCents: s.pointsMoneyCents,
        available: Math.max(s.stock - s.reserved, 0),
        status: s.status,
        seckill: seckillMap.get(s.id) ?? null,
      })),
      reviewSummary: {
        count: reviewAgg._count._all,
        avgRating: Math.round((reviewAgg._avg.rating ?? 0) * 10) / 10,
        items: reviews.map((r) => ({
          rating: r.rating,
          content: r.content,
          createdAt: r.createdAt,
        })),
      },
      memberCard,
    };
  }

  /**
   * 会员卡权益（公开可读）：后台存在折扣会员卡方案时返回，
   * 用于商品详情展示「VIP 价」引导开通；登录用户额外返回是否已持卡。
   */
  private async memberCardBenefit(userId?: string) {
    const plan = await this.prisma.memberCardPlan.findFirst({
      where: { enabled: true, discountRate: { lt: 1 } },
      orderBy: [{ discountRate: 'asc' }, { priceCents: 'asc' }],
      select: { name: true, priceCents: true, durationDays: true, discountRate: true },
    });
    if (!plan) return null;

    let levelRate = 1;
    let card: { discountRate: number } | null = null;
    if (userId) {
      const [user, activeCard] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId }, include: { level: true } }),
        this.prisma.memberCard.findFirst({
          where: { userId, status: 'ACTIVE', expireAt: { gt: new Date() } },
          orderBy: { expireAt: 'desc' },
          select: { discountRate: true },
        }),
      ]);
      levelRate = user?.level?.discountRate ?? 1;
      card = activeCard;
    }

    return {
      planName: plan.name,
      priceCents: plan.priceCents,
      durationDays: plan.durationDays,
      discountRate: plan.discountRate,
      active: Boolean(card),
      userRate: Math.min(levelRate, card?.discountRate ?? 1),
    };
  }
}
