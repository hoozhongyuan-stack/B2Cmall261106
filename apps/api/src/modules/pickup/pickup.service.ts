import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { nextStatus } from '@shanye/shared';

import { PrismaService, isUniqueViolation } from '../../prisma/prisma.module';
import type { AuthUser } from '../../common/auth.guards';
import { OperationLogService } from '../admin/operation-log.service';
import { StoreScopeService } from '../store/store-scope.service';

@Injectable()
export class PickupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: StoreScopeService,
    private readonly logs: OperationLogService,
  ) {}

  async list(
    user: AuthUser,
    query: { status?: string; storeId?: string; keyword?: string; date?: string },
  ) {
    const scope = await this.scopes.resolve(user);
    if (query.storeId && !scope.all && !scope.storeIds.includes(query.storeId)) {
      throw new NotFoundException('门店不存在');
    }
    const storeWhere = query.storeId
      ? { storeId: query.storeId }
      : scope.all
        ? {}
        : { storeId: { in: scope.storeIds } };
    const keyword = query.keyword?.trim();
    const dateRange = this.dateRange(query.date);

    if (query.status === 'verified') {
      const records = await this.prisma.pickupVerification.findMany({
        where: {
          ...storeWhere,
          ...(dateRange ? { verifiedAt: dateRange } : {}),
          ...(keyword
            ? {
                order: {
                  OR: [
                    { orderNo: { contains: keyword, mode: 'insensitive' } },
                    { pickupCode: { contains: keyword } },
                  ],
                },
              }
            : {}),
        },
        include: {
          order: { include: { store: { select: { name: true } }, items: true } },
        },
        orderBy: { verifiedAt: 'desc' },
        take: 100,
      });

      return {
        total: records.length,
        items: records.map((record) => ({
          id: record.id,
          orderId: record.orderId,
          orderNo: record.order.orderNo,
          storeId: record.storeId,
          storeName: record.order.store?.name ?? '',
          method: record.method,
          verifiedBy: record.verifiedBy,
          verifiedAt: record.verifiedAt,
          note: record.note,
          payableCents: record.order.payableCents,
          items: record.order.items.map((item) => ({
            title: item.title,
            specText: item.specText,
            quantity: item.quantity,
          })),
        })),
      };
    }

    const orders = await this.prisma.order.findMany({
      where: {
        ...storeWhere,
        fulfillmentType: 'PICKUP',
        status: 'PAID',
        pickupCode: { not: null },
        ...(dateRange ? { pickupAt: dateRange } : {}),
        ...(keyword
          ? {
              OR: [
                { orderNo: { contains: keyword, mode: 'insensitive' } },
                { pickupCode: { contains: keyword } },
              ],
            }
          : {}),
      },
      include: {
        store: { select: { name: true, address: true, phone: true } },
        items: true,
      },
      orderBy: { pickupCodeExpiresAt: 'asc' },
      take: 100,
    });

    return {
      total: orders.length,
      items: orders.map((order) => ({
        id: order.id,
        orderNo: order.orderNo,
        storeId: order.storeId,
        storeName: order.store?.name ?? '',
        storeAddress: order.store?.address ?? '',
        storePhone: order.store?.phone ?? null,
        pickupCode: order.pickupCode,
        pickupAt: order.pickupAt,
        pickupCodeExpiresAt: order.pickupCodeExpiresAt,
        payableCents: order.payableCents,
        phone: (order.addressSnapshot as { phone?: string } | null)?.phone ?? null,
        items: order.items.map((item) => ({
          title: item.title,
          specText: item.specText,
          quantity: item.quantity,
        })),
      })),
    };
  }

  async verify(user: AuthUser, code: string) {
    const normalized = code.trim();
    if (!/^\d{8}$/.test(normalized)) throw new NotFoundException('核销码不存在');

    const order = await this.prisma.order.findUnique({
      where: { pickupCode: normalized },
      include: {
        store: { select: { id: true, name: true, address: true, phone: true } },
        items: true,
        pickupVerification: true,
      },
    });
    if (!order) throw new NotFoundException('核销码不存在');
    if (order.fulfillmentType !== 'PICKUP' || !order.storeId) {
      throw new BadRequestException('该订单不是自提订单');
    }

    const scope = await this.scopes.resolve(user);
    if (!scope.all && !scope.storeIds.includes(order.storeId)) {
      throw new NotFoundException('核销码不存在');
    }

    if (order.pickupVerification) {
      return {
        alreadyVerified: true,
        order: this.toView(order),
        verification: order.pickupVerification,
      };
    }
    if (order.status !== 'PAID') {
      throw new BadRequestException('订单当前状态不可核销');
    }
    if (order.pickupCodeExpiresAt && order.pickupCodeExpiresAt < new Date()) {
      throw new BadRequestException('核销码已过期');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const moved = await tx.order.updateMany({
          where: {
            id: order.id,
            status: 'PAID',
            version: order.version,
            pickupCode: normalized,
          },
          data: {
            status: nextStatus('PAID', 'pickup_verify'),
            version: { increment: 1 },
            completedAt: new Date(),
          },
        });
        if (moved.count !== 1) {
          const existing = await tx.pickupVerification.findUnique({
            where: { orderId: order.id },
          });
          if (existing) return;
          throw new ConflictException('订单状态已变化，请刷新');
        }

        await tx.pickupVerification.create({
          data: {
            orderId: order.id,
            storeId: order.storeId!,
            method: 'CODE',
            verifiedBy: user.sub,
            note: null,
          },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const existing = await this.prisma.pickupVerification.findUnique({
          where: { orderId: order.id },
        });
        if (existing) {
          return { alreadyVerified: true, order: this.toView(order), verification: existing };
        }
      }
      throw err;
    }

    const latest = await this.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        store: { select: { id: true, name: true, address: true, phone: true } },
        items: true,
        pickupVerification: true,
      },
    });
    await this.logs.record({
      actorId: user.sub,
      actorName: user.name,
      action: 'PICKUP_VERIFY',
      targetType: 'Order',
      targetId: order.id,
      afterJson: {
        pickupCode: latest.pickupCode,
        storeId: latest.storeId,
        method: latest.pickupVerification?.method ?? 'CODE',
        verifiedAt: latest.pickupVerification?.verifiedAt ?? null,
      },
    });
    return {
      alreadyVerified: false,
      order: this.toView(latest),
      verification: latest.pickupVerification,
    };
  }

  private toView(order: {
    id: string;
    orderNo: string;
    status: string;
    pickupCode: string | null;
    pickupAt: Date | null;
    pickupCodeExpiresAt: Date | null;
    payableCents: number;
    store: { id: string; name: string; address: string; phone: string | null } | null;
    items: { title: string; specText: string; quantity: number }[];
  }) {
    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      pickupCode: order.pickupCode,
      pickupAt: order.pickupAt,
      pickupCodeExpiresAt: order.pickupCodeExpiresAt,
      payableCents: order.payableCents,
      store: order.store,
      items: order.items.map((item) => ({
        title: item.title,
        specText: item.specText,
        quantity: item.quantity,
      })),
    };
  }

  private dateRange(date?: string): { gte: Date; lt: Date } | null {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    return { gte: start, lt: end };
  }
}
