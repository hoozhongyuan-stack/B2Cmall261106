import type { TxClient } from '../../prisma/prisma.module';

export interface ExchangeOrderSnapshot {
  id: string;
  userId: string;
  orderType: string;
  pointsUsed: number;
  items: Array<{ skuId: string; quantity: number }>;
}

/**
 * 兑换订单回退：返还积分、写 EXCHANGE_REFUND 流水、回退每人限兑计数。
 * 库存回补由调用方按履约状态处理（未发货才回补）。
 * 取消、超时关单、后台整单退款三处共用，避免漏返。
 */
export async function revertPointsExchange(
  tx: TxClient,
  order: ExchangeOrderSnapshot,
): Promise<void> {
  if (order.orderType !== 'POINTS') return;

  if (order.pointsUsed > 0) {
    const user = await tx.user.update({
      where: { id: order.userId },
      data: { points: { increment: order.pointsUsed } },
      select: { points: true },
    });
    await tx.pointsLedger.create({
      data: {
        userId: order.userId,
        delta: order.pointsUsed,
        source: 'EXCHANGE_REFUND',
        reason: '积分兑换退回',
        orderId: order.id,
        balanceAfter: user.points,
      },
    });
  }

  if (order.items.length === 0) return;
  const skus = await tx.sku.findMany({
    where: { id: { in: [...new Set(order.items.map((item) => item.skuId))] } },
    select: { id: true, productId: true },
  });
  const productBySku = new Map(skus.map((sku) => [sku.id, sku.productId]));
  const quantityByProduct = new Map<string, number>();
  for (const item of order.items) {
    const productId = productBySku.get(item.skuId);
    if (!productId) continue;
    quantityByProduct.set(productId, (quantityByProduct.get(productId) ?? 0) + item.quantity);
  }

  for (const [productId, quantity] of quantityByProduct) {
    await tx.pointsMallQuota.updateMany({
      where: { userId: order.userId, productId, usedQty: { gte: quantity } },
      data: { usedQty: { decrement: quantity } },
    });
  }
}
