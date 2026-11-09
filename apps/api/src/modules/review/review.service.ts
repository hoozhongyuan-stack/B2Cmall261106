import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { averageRating, isCompleted, isValidRating, type OrderStatus } from '@shanye/shared';

import { PrismaService } from '../../prisma/prisma.module';
import { AssetService } from '../assets/asset.service';

const MAX_REVIEW_IMAGES = 9;

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetService,
  ) {}

  /** 买家评价：仅已完成订单、每个订单商品仅一次，先审后显 */
  async create(
    userId: string,
    input: {
      orderItemId: string;
      rating: number;
      content?: string;
      images?: string[];
      anonymous?: boolean;
    },
  ) {
    if (!isValidRating(input.rating)) {
      throw new BadRequestException('评分必须为 1~5 的整数');
    }
    if (input.content && input.content.length > 500) {
      throw new BadRequestException('评价内容不能超过 500 个字符');
    }

    const images = [...new Set((input.images ?? []).filter(Boolean))];
    if (images.length > MAX_REVIEW_IMAGES) {
      throw new BadRequestException(`最多上传 ${MAX_REVIEW_IMAGES} 张图片`);
    }
    // 晒图必须先上传到素材库，禁止外链
    await this.assets.assertReferences(images);

    const item = await this.prisma.orderItem.findFirst({
      where: { id: input.orderItemId, order: { userId } },
      include: { order: true, review: true },
    });
    if (!item) throw new NotFoundException('订单商品不存在');
    if (item.review) throw new ConflictException('该商品已评价');
    if (!isCompleted(item.order.status as OrderStatus)) {
      throw new ConflictException('仅已完成订单可评价');
    }

    return this.prisma.review.create({
      data: {
        orderItemId: item.id,
        orderId: item.orderId,
        userId,
        rating: input.rating,
        content: input.content,
        imagesJson: images,
        anonymous: input.anonymous ?? false,
        status: 'PENDING',
      },
    });
  }

  /** 评价页上下文：归属校验 + 商品信息 + 是否已评价，避免用户在空白页误评 */
  async context(userId: string, orderItemId: string) {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: orderItemId, order: { userId } },
      include: { order: { select: { status: true } }, review: { select: { id: true } } },
    });
    if (!item) throw new NotFoundException('订单商品不存在');

    return {
      id: item.id,
      title: item.title,
      specText: item.specText,
      imageKey: item.imageKey,
      priceCents: item.priceCents,
      quantity: item.quantity,
      reviewed: Boolean(item.review),
      orderStatus: item.order.status,
    };
  }

  /** 我的评价：含审核状态与商家回复 */
  async listMine(userId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { orderItem: { select: { title: true, specText: true, imageKey: true } } },
    });
    return {
      items: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        content: r.content,
        images: r.imagesJson ?? [],
        anonymous: r.anonymous,
        status: r.status,
        reply: r.reply,
        createdAt: r.createdAt,
        item: r.orderItem,
      })),
    };
  }

  /** 商品评价（公开）：只返回审核通过的评价与评分分布 */
  async listByProduct(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('商品不存在');

    const where = { status: 'SHOWN' as const, orderItem: { sku: { productId } } };
    const [reviews, grouped] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          orderItem: { select: { title: true, specText: true } },
          order: { include: { user: { select: { nickname: true, avatarKey: true } } } },
        },
      }),
      this.prisma.review.groupBy({ by: ['rating'], where, _count: { _all: true } }),
    ]);

    const count = grouped.reduce((sum, g) => sum + g._count._all, 0);
    const ratings = grouped.flatMap((g) => Array<number>(g._count._all).fill(g.rating));

    return {
      summary: {
        count,
        avgRating: averageRating(ratings),
        distribution: [5, 4, 3, 2, 1].map((rating) => ({
          rating,
          count: grouped.find((g) => g.rating === rating)?._count._all ?? 0,
        })),
      },
      items: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        content: r.content,
        images: r.imagesJson ?? [],
        createdAt: r.createdAt,
        specText: r.orderItem.specText,
        nickname: r.anonymous ? '匿名用户' : (r.order.user.nickname ?? '山野顾客'),
        avatarKey: r.anonymous ? null : r.order.user.avatarKey,
      })),
    };
  }

  /* ---------------- 后台 ---------------- */

  async listAdmin(
    status?: string,
    page = 1,
    pageSize = 20,
    filters: { keyword?: string; rating?: number; startDate?: string; endDate?: string } = {},
  ) {
    const currentPage = Math.max(page, 1);
    const size = Math.min(Math.max(pageSize, 1), 100);
    const search = filters.keyword?.trim();
    const createdAt =
      filters.startDate || filters.endDate
        ? {
            ...(filters.startDate
              ? { gte: new Date(`${filters.startDate}T00:00:00.000+08:00`) }
              : {}),
            ...(filters.endDate
              ? { lte: new Date(`${filters.endDate}T23:59:59.999+08:00`) }
              : {}),
          }
        : undefined;
    const where = {
      ...(status ? { status: status as never } : {}),
      ...(filters.rating ? { rating: filters.rating } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(search
        ? {
            OR: [
              { content: { contains: search, mode: 'insensitive' as const } },
              { order: { orderNo: { contains: search, mode: 'insensitive' as const } } },
              { orderItem: { title: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const [reviews, total, counts] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (currentPage - 1) * size,
        take: size,
        include: {
          orderItem: { select: { title: true, specText: true, imageKey: true } },
          order: { select: { orderNo: true, user: { select: { nickname: true, phone: true } } } },
        },
      }),
      this.prisma.review.count({ where }),
      this.prisma.review.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    return {
      counts: counts.map((c) => ({ status: c.status, count: c._count._all })),
      total,
      page: currentPage,
      pageSize: size,
      items: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        content: r.content,
        images: r.imagesJson ?? [],
        anonymous: r.anonymous,
        status: r.status,
        reply: r.reply,
        createdAt: r.createdAt,
        item: r.orderItem,
        orderNo: r.order.orderNo,
        customer: {
          nickname: r.anonymous ? '匿名用户' : r.order.user.nickname,
          phone: r.order.user.phone,
        },
      })),
    };
  }

  /** 审核：SHOWN 展示 / HIDDEN 隐藏；先审后显由 PENDING 起步 */
  async moderate(id: string, action: 'show' | 'hide') {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('评价不存在');
    return this.prisma.review.update({
      where: { id },
      data: { status: action === 'show' ? 'SHOWN' : 'HIDDEN' },
    });
  }

  /** 批量审核：逐条更新，返回成功/失败数量 */
  async batchModerate(ids: string[], action: 'show' | 'hide') {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) throw new BadRequestException('请选择评价');
    const result = await this.prisma.review.updateMany({
      where: { id: { in: unique } },
      data: { status: action === 'show' ? 'SHOWN' : 'HIDDEN' },
    });
    return { total: unique.length, success: result.count, failed: unique.length - result.count };
  }

  async reply(id: string, content: string) {
    if (!content?.trim()) throw new BadRequestException('回复内容不能为空');
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('评价不存在');
    return this.prisma.review.update({ where: { id }, data: { reply: content.trim() } });
  }
}
