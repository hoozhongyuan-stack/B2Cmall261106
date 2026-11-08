import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isDeliveryOverdue, nextStatus, type OrderStatus } from '@shanye/shared';

import { PrismaService } from '../../prisma/prisma.module';
import type { AuthUser } from '../../common/auth.guards';
import { OperationLogService } from '../admin/operation-log.service';
import { NotificationService } from '../notification/notification.service';
import { StoreScopeService } from '../store/store-scope.service';

const OPEN_DELIVERY_STATUSES = ['PENDING', 'ACCEPTED'] as const;

interface DeliveryRow {
  id: string;
  orderId: string;
  storeId: string;
  status: string;
  courierName: string | null;
  courierPhone: string | null;
  acceptedAt: Date | null;
  deliveredAt: Date | null;
  remark: string | null;
  createdAt: Date;
  store: { name: string } | null;
  order: {
    orderNo: string;
    status: OrderStatus;
    version: number;
    payableCents: number;
    addressSnapshot: unknown;
    items: { title: string; specText: string; quantity: number }[];
  };
}

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: StoreScopeService,
    private readonly logs: OperationLogService,
    private readonly notifications: NotificationService,
  ) {}

  async list(
    user: AuthUser,
    query: { status?: string; storeId?: string; date?: string },
  ) {
    const scope = await this.scopes.resolve(user);
    if (query.storeId) this.scopes.assertAccess(scope, query.storeId);

    const storeWhere = query.storeId
      ? { storeId: query.storeId }
      : scope.all
        ? {}
        : { storeId: { in: scope.storeIds } };
    const dateRange = this.dateRange(query.date);

    const deliveries = await this.prisma.delivery.findMany({
      where: {
        ...storeWhere,
        ...(query.status ? { status: query.status } : {}),
        ...(dateRange ? { createdAt: dateRange } : {}),
      },
      include: this.includeRow(),
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return { total: deliveries.length, items: deliveries.map((row) => this.view(row)) };
  }

  /** 接单：PENDING → ACCEPTED，同时订单 PAID → SHIPPED */
  async accept(
    user: AuthUser,
    id: string,
    input: { courierName?: string; courierPhone?: string },
  ) {
    const detail = await this.load(user, id);
    if (detail.status === 'ACCEPTED') {
      return { alreadyAccepted: true, delivery: this.view(detail) };
    }
    if (detail.status !== 'PENDING') {
      throw new ConflictException('配送单当前状态不可接单');
    }
    if (detail.order.status !== 'PAID') {
      throw new ConflictException('订单当前状态不可接单');
    }

    const next = nextStatus('PAID', 'accept_delivery');
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.delivery.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'ACCEPTED',
          courierName: input.courierName?.trim() || null,
          courierPhone: input.courierPhone?.trim() || null,
          acceptedAt: new Date(),
        },
      });
      if (moved.count !== 1) throw new ConflictException('配送单状态已变化，请刷新');

      const orderMoved = await tx.order.updateMany({
        where: {
          id: detail.orderId,
          status: detail.order.status,
          version: detail.order.version,
        },
        data: { status: next as never, version: { increment: 1 }, shippedAt: new Date() },
      });
      if (orderMoved.count !== 1) throw new ConflictException('订单状态已变化，请刷新');
    });

    await this.recordLog(user, 'DELIVERY_ACCEPT', id, {
      courierName: input.courierName?.trim() || null,
      courierPhone: input.courierPhone?.trim() || null,
    });
    try {
      await this.notifications.enqueueDeliveryAccepted(id);
    } catch (err) {
      this.logger.warn(`配送接单通知入队失败 delivery=${id}`, err as Error);
    }
    return { alreadyAccepted: false, delivery: this.view(await this.load(user, id)) };
  }

  /** 送达：ACCEPTED → DELIVERED，同时订单 SHIPPED → COMPLETED */
  async deliver(user: AuthUser, id: string) {
    const detail = await this.load(user, id);
    if (detail.status === 'DELIVERED') {
      return { alreadyDelivered: true, delivery: this.view(detail) };
    }
    if (detail.status !== 'ACCEPTED') {
      throw new ConflictException('请先接单再送达');
    }
    if (detail.order.status !== 'SHIPPED') {
      throw new ConflictException('订单当前状态不可送达');
    }

    const next = nextStatus('SHIPPED', 'deliver_complete');
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.delivery.updateMany({
        where: { id, status: 'ACCEPTED' },
        data: { status: 'DELIVERED', deliveredAt: new Date() },
      });
      if (moved.count !== 1) throw new ConflictException('配送单状态已变化，请刷新');

      const orderMoved = await tx.order.updateMany({
        where: {
          id: detail.orderId,
          status: detail.order.status,
          version: detail.order.version,
        },
        data: { status: next as never, version: { increment: 1 }, completedAt: new Date() },
      });
      if (orderMoved.count !== 1) throw new ConflictException('订单状态已变化，请刷新');
    });

    await this.recordLog(user, 'DELIVERY_COMPLETE', id, null);
    try {
      await this.notifications.enqueueDeliveryDone(id);
    } catch (err) {
      this.logger.warn(`配送完成通知入队失败 delivery=${id}`, err as Error);
    }
    return { alreadyDelivered: false, delivery: this.view(await this.load(user, id)) };
  }

  /** 取消：仅待接单/配送中，需填写原因；订单状态不回退，由售后处理 */
  async cancel(user: AuthUser, id: string, reason: string) {
    const detail = await this.load(user, id);
    const trimmed = reason?.trim();
    if (!trimmed) throw new BadRequestException('请填写取消原因');
    if (!OPEN_DELIVERY_STATUSES.includes(detail.status as never)) {
      throw new ConflictException('仅待接单或配送中可取消');
    }

    const moved = await this.prisma.delivery.updateMany({
      where: { id, status: detail.status },
      data: { status: 'CANCELLED', remark: trimmed },
    });
    if (moved.count !== 1) throw new ConflictException('配送单状态已变化，请刷新');

    await this.recordLog(user, 'DELIVERY_CANCEL', id, { reason: trimmed });
    return { delivery: this.view(await this.load(user, id)) };
  }

  private includeRow() {
    return {
      store: { select: { name: true } },
      order: { include: { items: true } },
    } as const;
  }

  private async load(user: AuthUser, id: string): Promise<DeliveryRow> {
    const detail = await this.prisma.delivery.findUnique({
      where: { id },
      include: this.includeRow(),
    });
    if (!detail) throw new NotFoundException('配送单不存在');

    const scope = await this.scopes.resolve(user);
    this.scopes.assertAccess(scope, detail.storeId);
    return detail as DeliveryRow;
  }

  private view(row: DeliveryRow) {
    const address = (row.order.addressSnapshot ?? {}) as {
      receiver?: string;
      phone?: string;
      region?: string;
      detail?: string;
    };
    return {
      id: row.id,
      orderId: row.orderId,
      orderNo: row.order.orderNo,
      orderStatus: row.order.status,
      storeId: row.storeId,
      storeName: row.store?.name ?? '',
      status: row.status,
      overdue: isDeliveryOverdue({
        status: row.status,
        createdAt: row.createdAt,
        acceptedAt: row.acceptedAt,
      }),
      courierName: row.courierName,
      courierPhone: row.courierPhone,
      acceptedAt: row.acceptedAt,
      deliveredAt: row.deliveredAt,
      remark: row.remark,
      createdAt: row.createdAt,
      receiver: address.receiver ?? null,
      phone: address.phone ?? null,
      address: address.region ? `${address.region} ${address.detail ?? ''}`.trim() : null,
      payableCents: row.order.payableCents,
      items: row.order.items.map((item) => ({
        title: item.title,
        specText: item.specText,
        quantity: item.quantity,
      })),
    };
  }

  private async recordLog(
    user: AuthUser,
    action: string,
    id: string,
    afterJson: unknown,
  ): Promise<void> {
    await this.logs.record({
      actorId: user.sub,
      actorName: user.name,
      action,
      targetType: 'Delivery',
      targetId: id,
      afterJson,
    });
  }

  private dateRange(date?: string): { gte: Date; lt: Date } | null {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    return { gte: start, lt: end };
  }
}
