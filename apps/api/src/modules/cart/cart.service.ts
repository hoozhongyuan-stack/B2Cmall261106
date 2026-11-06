import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.module';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const items = await this.prisma.cartItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { sku: { include: { product: true } } },
    });

    type CartRow = {
      id: string;
      skuId: string;
      quantity: number;
      checked: boolean;
      title: string;
      spec: Record<string, string>;
      imageKey: string | null;
      priceCents: number;
      available: number;
      subtotalCents: number;
      invalidReason?: string;
    };

    const valid: CartRow[] = [];
    const invalid: CartRow[] = [];
    for (const item of items) {
      const available = Math.max(item.sku.stock - item.sku.reserved, 0);
      const row: CartRow = {
        id: item.id,
        skuId: item.skuId,
        quantity: item.quantity,
        checked: item.checked,
        title: item.sku.product.title,
        spec: item.sku.specJson as Record<string, string>,
        imageKey: item.sku.product.mainImageKey,
        priceCents: item.sku.priceCents,
        available,
        subtotalCents: item.sku.priceCents * item.quantity,
      };
      // 失效区：已下架 / 售罄 / 库存不足，前端单独成区
      const usable =
        item.sku.status === 'ON_SALE' &&
        item.sku.product.status === 'ON_SALE' &&
        available >= item.quantity;
      (usable ? valid : invalid).push({
        ...row,
        invalidReason: usable
          ? undefined
          : item.sku.status !== 'ON_SALE' || item.sku.product.status !== 'ON_SALE'
            ? '已下架'
            : available === 0
              ? '已售罄'
              : `仅剩 ${available} 件`,
      });
    }

    const checkedItems = valid.filter((i) => i.checked);
    return {
      valid,
      invalid,
      summary: {
        checkedCount: checkedItems.reduce((s, i) => s + i.quantity, 0),
        checkedAmountCents: checkedItems.reduce((s, i) => s + i.subtotalCents, 0),
      },
    };
  }

  async add(userId: string, skuId: string, quantity: number) {
    const sku = await this.prisma.sku.findUnique({ where: { id: skuId } });
    if (!sku || sku.status !== 'ON_SALE') throw new NotFoundException('商品不存在或已下架');

    const available = Math.max(sku.stock - sku.reserved, 0);
    if (available <= 0) throw new NotFoundException('已售罄');

    const existing = await this.prisma.cartItem.findUnique({
      where: { userId_skuId: { userId, skuId } },
    });
    const nextQty = (existing?.quantity ?? 0) + quantity;
    if (nextQty > available) throw new NotFoundException(`仅剩 ${available} 件`);

    const item = await this.prisma.cartItem.upsert({
      where: { userId_skuId: { userId, skuId } },
      update: { quantity: nextQty },
      create: { userId, skuId, quantity },
    });
    return { id: item.id, quantity: item.quantity };
  }

  async update(userId: string, id: string, patch: { quantity?: number; checked?: boolean }) {
    const item = await this.prisma.cartItem.findFirst({ where: { id, userId } });
    if (!item) throw new NotFoundException('购物车条目不存在');

    if (patch.quantity !== undefined) {
      const sku = await this.prisma.sku.findUnique({ where: { id: item.skuId } });
      const available = Math.max((sku?.stock ?? 0) - (sku?.reserved ?? 0), 0);
      if (patch.quantity > available) throw new NotFoundException(`仅剩 ${available} 件`);
    }

    const updated = await this.prisma.cartItem.update({
      where: { id },
      data: { ...patch },
    });
    return { id: updated.id, quantity: updated.quantity, checked: updated.checked };
  }

  /** 删除指定条目；传 clearInvalid 时删除全部失效商品 */
  async remove(userId: string, ids: string[]) {
    const result = await this.prisma.cartItem.deleteMany({
      where: { userId, id: { in: ids } },
    });
    return { deleted: result.count };
  }

  async clearInvalid(userId: string) {
    const items = await this.prisma.cartItem.findMany({
      where: { userId },
      include: { sku: { include: { product: true } } },
    });
    const invalidIds = items
      .filter((item) => {
        const available = Math.max(item.sku.stock - item.sku.reserved, 0);
        return (
          item.sku.status !== 'ON_SALE' ||
          item.sku.product.status !== 'ON_SALE' ||
          available < item.quantity
        );
      })
      .map((i) => i.id);

    const result = await this.prisma.cartItem.deleteMany({
      where: { userId, id: { in: invalidIds } },
    });
    return { deleted: result.count };
  }
}
