import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.module';

export interface PromotionLine {
  productId: string;
  categoryId: string;
  seckill: boolean;
}

export interface SeckillMatch {
  id: string;
  promotionId: string;
  promotionName: string;
  priceCents: number;
  stock: number;
  sold: number;
  limitPerUser: number;
}

export interface FullReductionMatch {
  id: string;
  name: string;
  thresholdCents: number;
  discountCents: number;
  endAt: Date;
}

export interface PromotionInput {
  name?: string;
  type?: 'FULL_REDUCTION' | 'SECKILL';
  enabled?: boolean;
  startAt?: string;
  endAt?: string;
  thresholdCents?: number;
  discountCents?: number;
  scopeType?: 'ALL' | 'CATEGORY' | 'PRODUCT';
  scopes?: { targetType: 'CATEGORY' | 'PRODUCT'; targetId: string }[];
  skus?: {
    skuId: string;
    seckillPriceCents: number;
    stock: number;
    limitPerUser: number;
    sort?: number;
  }[];
}

@Injectable()
export class PromotionService {
  constructor(private readonly prisma: PrismaService) {}

  /** 当前有效的秒杀：同 SKU 取最低秒杀价 */
  async seckillForSkus(
    skuIds: string[],
    tx?: { seckillSku: PrismaService['seckillSku'] },
  ): Promise<Map<string, SeckillMatch>> {
    const db = tx ?? this.prisma;
    if (!skuIds.length) return new Map();
    const now = new Date();
    const rows = await db.seckillSku.findMany({
      where: {
        skuId: { in: skuIds },
        promotion: { type: 'SECKILL', enabled: true, startAt: { lte: now }, endAt: { gte: now } },
      },
      include: { promotion: true },
    });

    const result = new Map<string, SeckillMatch>();
    for (const row of rows) {
      if (row.sold >= row.stock) continue;
      const current = result.get(row.skuId);
      if (current && current.priceCents <= row.seckillPriceCents) continue;
      result.set(row.skuId, {
        id: row.id,
        promotionId: row.promotionId,
        promotionName: row.promotion.name,
        priceCents: row.seckillPriceCents,
        stock: row.stock,
        sold: row.sold,
        limitPerUser: row.limitPerUser,
      });
    }
    return result;
  }

  /** 命中当前订单商品范围的满减活动（门槛在券后金额确定后再判断） */
  async fullReductionCandidates(lines: PromotionLine[]): Promise<FullReductionMatch[]> {
    const eligible = lines.filter((line) => !line.seckill);
    if (!eligible.length) return [];

    const productIds = new Set(eligible.map((line) => line.productId));
    const categoryIds = new Set(eligible.map((line) => line.categoryId));
    const now = new Date();
    const promotions = await this.prisma.promotion.findMany({
      where: { type: 'FULL_REDUCTION', enabled: true, startAt: { lte: now }, endAt: { gte: now } },
      include: { scopes: true },
      orderBy: { endAt: 'asc' },
    });

    return promotions
      .filter((promotion) => {
        if (!promotion.thresholdCents || !promotion.discountCents) return false;
        if (promotion.scopeType === 'ALL') return true;
        return promotion.scopes.some((scope) =>
          scope.targetType === 'PRODUCT'
            ? productIds.has(scope.targetId)
            : categoryIds.has(scope.targetId),
        );
      })
      .map((promotion) => ({
        id: promotion.id,
        name: promotion.name,
        thresholdCents: promotion.thresholdCents!,
        discountCents: promotion.discountCents!,
        endAt: promotion.endAt,
      }));
  }

  /** 小程序：进行中的秒杀商品 */
  async activeSeckills() {
    const now = new Date();
    const promotions = await this.prisma.promotion.findMany({
      where: { type: 'SECKILL', enabled: true, startAt: { lte: now }, endAt: { gte: now } },
      include: {
        skus: {
          include: { sku: { include: { product: true } } },
          orderBy: { sort: 'asc' },
        },
      },
      orderBy: { endAt: 'asc' },
      take: 5,
    });

    const items = promotions.flatMap((promotion) =>
      promotion.skus
        .filter((row) => row.sold < row.stock && row.sku.product.channel === 'NORMAL')
        .map((row) => ({
          promotionId: promotion.id,
          promotionName: promotion.name,
          endAt: promotion.endAt,
          skuId: row.skuId,
          productId: row.sku.productId,
          title: row.sku.product.title,
          imageKey: row.sku.product.mainImageKey,
          originalPriceCents: row.sku.priceCents,
          seckillPriceCents: row.seckillPriceCents,
          stockLeft: row.stock - row.sold,
          limitPerUser: row.limitPerUser,
        })),
    );
    return { items };
  }

  /** 商品详情：返回 SKU 对应的秒杀信息 */
  async seckillForProduct(skuIds: string[]) {
    const matches = await this.seckillForSkus(skuIds);
    return Object.fromEntries(
      [...matches.entries()].map(([skuId, match]) => [
        skuId,
        {
          promotionId: match.promotionId,
          promotionName: match.promotionName,
          priceCents: match.priceCents,
          stockLeft: match.stock - match.sold,
          limitPerUser: match.limitPerUser,
        },
      ]),
    );
  }

  /* ---------------- 后台 ---------------- */

  async adminList() {
    const items = await this.prisma.promotion.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        scopes: true,
        skus: {
          include: { sku: { include: { product: true } } },
          orderBy: { sort: 'asc' },
        },
      },
    });
    return {
      items: items.map((promotion) => ({
        id: promotion.id,
        name: promotion.name,
        type: promotion.type,
        enabled: promotion.enabled,
        startAt: promotion.startAt,
        endAt: promotion.endAt,
        thresholdCents: promotion.thresholdCents,
        discountCents: promotion.discountCents,
        scopeType: promotion.scopeType,
        scopes: promotion.scopes.map((scope) => ({
          targetType: scope.targetType,
          targetId: scope.targetId,
        })),
        skus: promotion.skus.map((row) => ({
          id: row.id,
          skuId: row.skuId,
          skuCode: row.sku.code,
          productTitle: row.sku.product.title,
          originalPriceCents: row.sku.priceCents,
          seckillPriceCents: row.seckillPriceCents,
          stock: row.stock,
          sold: row.sold,
          limitPerUser: row.limitPerUser,
        })),
      })),
    };
  }

  async create(input: PromotionInput) {
    const data = await this.normalize(input, true);
    return this.prisma.promotion.create({
      data: {
        ...data.base,
        ...(data.scopes.length ? { scopes: { create: data.scopes } } : {}),
        ...(data.skus.length ? { skus: { create: data.skus } } : {}),
      } as never,
    });
  }

  async update(id: string, input: PromotionInput) {
    const current = await this.prisma.promotion.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('活动不存在');
    const data = await this.normalize(
      { ...input, type: (input.type ?? current.type) as 'FULL_REDUCTION' | 'SECKILL' },
      false,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.promotion.update({ where: { id }, data: data.base as never });
      if (input.scopes !== undefined) {
        await tx.promotionScope.deleteMany({ where: { promotionId: id } });
        if (data.scopes.length) {
          await tx.promotionScope.createMany({
            data: data.scopes.map((scope) => ({ ...scope, promotionId: id })),
          });
        }
      }
      if (input.skus !== undefined) {
        await tx.seckillSku.deleteMany({ where: { promotionId: id } });
        if (data.skus.length) {
          await tx.seckillSku.createMany({
            data: data.skus.map((sku) => ({ ...sku, promotionId: id })),
          });
        }
      }
      return { id };
    });
  }

  async remove(id: string) {
    const current = await this.prisma.promotion.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('活动不存在');
    await this.prisma.promotion.delete({ where: { id } });
    return { deleted: true };
  }

  private async normalize(input: PromotionInput, creating: boolean) {
    const type = input.type;
    if (!type || !['FULL_REDUCTION', 'SECKILL'].includes(type)) {
      throw new BadRequestException('活动类型不合法');
    }

    const name = (input.name ?? '').trim();
    if (creating && !name) throw new BadRequestException('请填写活动名称');
    if (name.length > 30) throw new BadRequestException('活动名称不能超过 30 个字符');

    const startAt = input.startAt ? new Date(input.startAt) : new Date();
    const endAt = input.endAt ? new Date(input.endAt) : null;
    if (!endAt || Number.isNaN(endAt.getTime()) || Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('请填写有效的活动时间');
    }
    if (endAt <= startAt) throw new BadRequestException('结束时间必须晚于开始时间');

    const base: Record<string, unknown> = {
      type,
      ...(name ? { name } : {}),
      startAt,
      endAt,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    };

    if (type === 'FULL_REDUCTION') {
      const threshold = input.thresholdCents;
      const discount = input.discountCents;
      if (threshold !== undefined) {
        if (!Number.isInteger(threshold) || threshold <= 0) {
          throw new BadRequestException('满减门槛必须为正整数分');
        }
        base.thresholdCents = threshold;
      } else if (creating) {
        throw new BadRequestException('请填写满减门槛');
      }
      if (discount !== undefined) {
        if (!Number.isInteger(discount) || discount <= 0) {
          throw new BadRequestException('满减金额必须为正整数分');
        }
        base.discountCents = discount;
      } else if (creating) {
        throw new BadRequestException('请填写满减金额');
      }
      if (
        typeof base.thresholdCents === 'number' &&
        typeof base.discountCents === 'number' &&
        base.discountCents > base.thresholdCents
      ) {
        throw new BadRequestException('满减金额不能大于门槛');
      }

      const scopeType = input.scopeType ?? 'ALL';
      if (!['ALL', 'CATEGORY', 'PRODUCT'].includes(scopeType)) {
        throw new BadRequestException('满减范围不合法');
      }
      base.scopeType = scopeType;

      const scopes = (input.scopes ?? []).map((scope) => ({
        targetType: scope.targetType,
        targetId: scope.targetId,
      }));
      if (scopeType !== 'ALL' && creating && !scopes.length) {
        throw new BadRequestException('请选择满减范围目标');
      }
      await this.assertScopeTargets(scopes);
      return { base, scopes, skus: [] };
    }

    const skus = input.skus ?? [];
    if (creating && !skus.length) throw new BadRequestException('请至少添加一个秒杀商品');
    for (const row of skus) {
      if (!Number.isInteger(row.seckillPriceCents) || row.seckillPriceCents <= 0) {
        throw new BadRequestException('秒杀价必须为正整数分');
      }
      if (!Number.isInteger(row.stock) || row.stock <= 0) {
        throw new BadRequestException('秒杀库存必须为正整数');
      }
      if (!Number.isInteger(row.limitPerUser) || row.limitPerUser <= 0) {
        throw new BadRequestException('每人限购必须为正整数');
      }
      const sku = await this.prisma.sku.findUnique({
        where: { id: row.skuId },
        select: { priceCents: true },
      });
      if (!sku) throw new BadRequestException('秒杀商品不存在');
      if (row.seckillPriceCents >= sku.priceCents) {
        throw new BadRequestException('秒杀价必须低于商品原价');
      }
    }
    return {
      base,
      scopes: [],
      skus: skus.map((row) => ({
        skuId: row.skuId,
        seckillPriceCents: row.seckillPriceCents,
        stock: row.stock,
        limitPerUser: row.limitPerUser,
        sort: row.sort ?? 0,
      })),
    };
  }

  private async assertScopeTargets(
    scopes: { targetType: string; targetId: string }[],
  ): Promise<void> {
    for (const scope of scopes) {
      if (scope.targetType === 'PRODUCT') {
        const product = await this.prisma.product.findUnique({ where: { id: scope.targetId } });
        if (!product) throw new BadRequestException('满减商品不存在');
      } else if (scope.targetType === 'CATEGORY') {
        const category = await this.prisma.category.findUnique({ where: { id: scope.targetId } });
        if (!category) throw new BadRequestException('满减分类不存在');
      } else {
        throw new BadRequestException('满减范围类型不合法');
      }
    }
  }
}
