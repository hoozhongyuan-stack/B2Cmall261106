import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../../prisma/prisma.module';

@ApiTags('catalog')
@Controller('products')
export class ProductDetailController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  @ApiOperation({ summary: '商品详情：SKU、标签、评价摘要' })
  async detail(@Param('id') id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        skus: { orderBy: { priceCents: 'asc' } },
        tags: true,
        category: true,
      },
    });
    if (!product) throw new NotFoundException('商品不存在或已下架');

    const [reviews, reviewAgg, seckillRows] = await Promise.all([
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
    };
  }
}
