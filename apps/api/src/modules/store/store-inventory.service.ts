import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { PrismaService, type TxClient } from '../../prisma/prisma.module';
import { reserveStoreSku } from '../../prisma/queries';

export type FulfillmentType = 'EXPRESS' | 'DELIVERY' | 'PICKUP';

export interface InventoryLine {
  skuId: string;
  quantity: number;
}

export interface FulfillmentStore {
  id: string;
  name: string;
  phone: string | null;
  region: string;
  address: string;
  businessHours: unknown;
  pickupCompleteDays: number;
  deliveryEnabled: boolean;
  deliveryFeeCents: number;
  freeDeliveryThresholdCents: number;
  deliverySlots: unknown;
  deliveryCutoff: string | null;
  maxOrdersPerSlot: number;
}

/**
 * 门店库存事务助手：只服务自提与同城配送。
 * 快递仍走总部仓 Sku.stock/reserved，两者互不影响。
 *
 * StoreStockLog 的 beforeStock / afterStock / delta 均按「可售库存
 * （stock - reserved）」记录，便于运营理解预占与释放。
 */
@Injectable()
export class StoreInventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveFulfillment(input: {
    fulfillmentType?: string;
    storeId?: string;
  }): Promise<{ type: FulfillmentType; storeId: string | null; store: FulfillmentStore | null }> {
    const type = (input.fulfillmentType ?? 'EXPRESS') as FulfillmentType;
    if (!['EXPRESS', 'DELIVERY', 'PICKUP'].includes(type)) {
      throw new BadRequestException('履约方式不合法');
    }
    if (type === 'EXPRESS') {
      if (input.storeId) throw new BadRequestException('快递订单无需选择门店');
      return { type, storeId: null, store: null };
    }
    if (!input.storeId) throw new BadRequestException('请选择履约门店');

    const store = await this.prisma.store.findUnique({ where: { id: input.storeId } });
    if (!store || store.status !== 'ACTIVE') {
      throw new BadRequestException('门店不存在或已停用');
    }
    if (store.temporarilyClosedUntil && store.temporarilyClosedUntil > new Date()) {
      throw new BadRequestException('该门店临时打烊中，请稍后再试或切换门店');
    }
    if (type === 'PICKUP' && !store.pickupEnabled) {
      throw new BadRequestException('该门店暂不支持自提');
    }
    if (type === 'DELIVERY' && !store.deliveryEnabled) {
      throw new BadRequestException('该门店暂不支持同城配送');
    }
    return { type, storeId: store.id, store };
  }

  /** 门店可售库存：仅返回启用中的 StoreSku，缺失视为 0 */
  async availableMap(storeId: string, skuIds: string[]): Promise<Map<string, number>> {
    if (!skuIds.length) return new Map();
    const rows = await this.prisma.storeSku.findMany({
      where: { storeId, skuId: { in: skuIds } },
      select: { skuId: true, stock: true, reserved: true, status: true },
    });
    return new Map(
      rows.map((row) => [
        row.skuId,
        row.status === 'ON_SALE' ? Math.max(row.stock - row.reserved, 0) : 0,
      ]),
    );
  }

  async reserve(tx: TxClient, storeId: string, lines: InventoryLine[]): Promise<void> {
    for (const line of lines) {
      const updated = await reserveStoreSku(tx, storeId, line.skuId, line.quantity);
      if (updated !== 1) {
        throw new ConflictException('门店库存不足，请切换门店或改为快递');
      }
      const row = await tx.storeSku.findUnique({
        where: { storeId_skuId: { storeId, skuId: line.skuId } },
      });
      if (row) {
        const after = row.stock - row.reserved;
        await this.log(tx, {
          storeId,
          skuId: line.skuId,
          delta: -line.quantity,
          beforeStock: after + line.quantity,
          afterStock: after,
          reason: 'ORDER_RESERVE',
        });
      }
    }
  }

  /** 取消 / 超时关单：释放预占，可重复调用 */
  async release(
    tx: TxClient,
    storeId: string,
    lines: InventoryLine[],
    orderId?: string,
  ): Promise<void> {
    for (const line of lines) {
      const updated = await tx.storeSku.updateMany({
        where: { storeId, skuId: line.skuId, reserved: { gte: line.quantity } },
        data: { reserved: { decrement: line.quantity } },
      });
      if (updated.count !== 1) continue;

      const row = await tx.storeSku.findUnique({
        where: { storeId_skuId: { storeId, skuId: line.skuId } },
      });
      if (row) {
        const after = row.stock - row.reserved;
        await this.log(tx, {
          storeId,
          skuId: line.skuId,
          delta: line.quantity,
          beforeStock: after - line.quantity,
          afterStock: after,
          reason: 'ORDER_RELEASE',
          orderId,
        });
      }
    }
  }

  /** 支付成功：预占转为真实扣减，可售库存不变 */
  async commit(
    tx: TxClient,
    storeId: string,
    lines: InventoryLine[],
    orderId?: string,
  ): Promise<void> {
    for (const line of lines) {
      const updated = await tx.storeSku.updateMany({
        where: {
          storeId,
          skuId: line.skuId,
          stock: { gte: line.quantity },
          reserved: { gte: line.quantity },
        },
        data: {
          stock: { decrement: line.quantity },
          reserved: { decrement: line.quantity },
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('门店库存结算失败，请联系客服');
      }
      const row = await tx.storeSku.findUnique({
        where: { storeId_skuId: { storeId, skuId: line.skuId } },
      });
      if (row) {
        const after = row.stock - row.reserved;
        await this.log(tx, {
          storeId,
          skuId: line.skuId,
          delta: 0,
          beforeStock: after,
          afterStock: after,
          reason: 'ORDER_PAID',
          orderId,
        });
      }
    }
  }

  /** 未发货退款：库存回到门店可售 */
  async restock(
    tx: TxClient,
    storeId: string,
    lines: InventoryLine[],
    orderId?: string,
  ): Promise<void> {
    for (const line of lines) {
      const updated = await tx.storeSku.updateMany({
        where: { storeId, skuId: line.skuId },
        data: { stock: { increment: line.quantity } },
      });
      if (updated.count !== 1) continue;

      const row = await tx.storeSku.findUnique({
        where: { storeId_skuId: { storeId, skuId: line.skuId } },
      });
      if (row) {
        const after = row.stock - row.reserved;
        await this.log(tx, {
          storeId,
          skuId: line.skuId,
          delta: line.quantity,
          beforeStock: after - line.quantity,
          afterStock: after,
          reason: 'REFUND',
          orderId,
        });
      }
    }
  }

  private async log(
    tx: TxClient,
    data: {
      storeId: string;
      skuId: string;
      delta: number;
      beforeStock: number;
      afterStock: number;
      reason: string;
      orderId?: string;
      operatorId?: string;
    },
  ): Promise<void> {
    await tx.storeStockLog.create({ data });
  }
}
