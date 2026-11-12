import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { nextStatus } from '@shanye/shared';

import { PrismaService } from '../../prisma/prisma.module';
import { CouponService } from '../coupon/coupon.service';
import { StoreInventoryService } from '../store/store-inventory.service';
import { revertPointsExchange } from '../points-mall/points-order.util';

const INTERVAL_MS = 60_000;

/**
 * 超时关单：每 60 秒扫描已过支付时限的待付款订单，关单并释放预占库存。
 * 与支付并发时依赖 version 乐观锁，只有一个结果生效。
 */
@Injectable()
export class OrderTimeoutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderTimeoutService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly coupons: CouponService,
    private readonly storeInventory: StoreInventoryService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.closeExpired().catch((err) => this.logger.error('超时关单失败', err));
    }, INTERVAL_MS);
    // 不阻塞进程退出
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 返回本次关闭的订单数；供定时任务与后台手动触发共用 */
  async closeExpired(): Promise<{ closed: number }> {
    const expired = await this.prisma.order.findMany({
      where: { status: 'PENDING_PAYMENT', payDeadlineAt: { lt: new Date() } },
      include: { items: true, payments: true },
      take: 100,
    });

    let closed = 0;
    for (const order of expired) {
      // 关单前再确认没有成功支付，避免「刚支付就被关单」
      if (order.payments.some((p) => p.status === 'SUCCESS')) continue;

      const changed = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.order.updateMany({
          where: { id: order.id, status: 'PENDING_PAYMENT', version: order.version },
          data: {
            status: nextStatus('PENDING_PAYMENT', 'cancel'),
            version: { increment: 1 },
            closedAt: new Date(),
          },
        });
        if (updated.count !== 1) return false;

        if (order.storeId) {
          await this.storeInventory.release(
            tx,
            order.storeId,
            order.items.map((item) => ({ skuId: item.skuId, quantity: item.quantity })),
            order.id,
          );
        }

        for (const item of order.items) {
          if (!order.storeId) {
            await tx.sku.update({
              where: { id: item.skuId },
              data: { reserved: { decrement: item.quantity } },
            });
          }
          if (item.seckillId) {
            await tx.seckillSku.updateMany({
              where: { id: item.seckillId, sold: { gte: item.quantity } },
              data: { sold: { decrement: item.quantity } },
            });
          }
        }

        // 超时关单等同取消：已锁定的券在有效期内退回
        await this.coupons.releaseForOrder(tx, order.id);
        // 积分兑换单：返还积分并回退每人限兑计数
        await revertPointsExchange(tx, order);
        return true;
      });

      if (changed) closed += 1;
    }

    if (closed > 0) this.logger.log(`超时关单 ${closed} 笔，库存已释放`);
    return { closed };
  }
}
