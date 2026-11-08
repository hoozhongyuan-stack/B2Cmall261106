import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { nextStatus } from '@shanye/shared';

import { PrismaService, isUniqueViolation } from '../../prisma/prisma.module';
import { NotificationService } from '../notification/notification.service';

const INTERVAL_MS = 10 * 60_000;

/**
 * 自提超时：到期前 1 天提醒，到期后自动完成。
 * 自动完成不回滚库存、不退款，核销记录 method=AUTO。
 */
@Injectable()
export class PickupTimeoutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PickupTimeoutService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.run().catch((err) => this.logger.error('自提超时任务失败', err));
    }, INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async run(now = new Date()): Promise<{ reminded: number; completed: number }> {
    const expiring = await this.prisma.order.findMany({
      where: {
        fulfillmentType: 'PICKUP',
        status: 'PAID',
        pickupCodeExpiresAt: {
          gt: now,
          lte: new Date(now.getTime() + 86_400_000),
        },
      },
      select: { id: true },
      take: 50,
    });
    let reminded = 0;
    for (const order of expiring) {
      try {
        await this.notifications.enqueuePickupExpiring(order.id);
        reminded += 1;
      } catch (err) {
        this.logger.warn(`自提到期提醒入队失败 order=${order.id}`, err as Error);
      }
    }

    const expired = await this.prisma.order.findMany({
      where: {
        fulfillmentType: 'PICKUP',
        status: 'PAID',
        pickupCodeExpiresAt: { lte: now },
      },
      take: 50,
    });
    let completed = 0;
    for (const order of expired) {
      try {
        const done = await this.complete(order);
        if (done) completed += 1;
      } catch (err) {
        this.logger.error(`自提自动完成失败 order=${order.id}`, err as Error);
      }
    }
    return { reminded, completed };
  }

  private async complete(order: {
    id: string;
    version: number;
    storeId: string | null;
  }): Promise<boolean> {
    if (!order.storeId) return false;
    return this.prisma.$transaction(async (tx) => {
      const moved = await tx.order.updateMany({
        where: { id: order.id, status: 'PAID', version: order.version },
        data: {
          status: nextStatus('PAID', 'pickup_verify') as never,
          version: { increment: 1 },
          completedAt: new Date(),
        },
      });
      if (moved.count !== 1) return false;

      try {
        await tx.pickupVerification.create({
          data: {
            orderId: order.id,
            storeId: order.storeId!,
            method: 'AUTO',
            note: '超时未取，系统自动完成',
          },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
      return true;
    });
  }
}
