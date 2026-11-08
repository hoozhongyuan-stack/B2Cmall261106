import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isDeliveryOverdue } from '@shanye/shared';

import { PrismaService, isUniqueViolation } from '../../prisma/prisma.module';
import type { AuthUser } from '../../common/auth.guards';
import { StoreScopeService } from './store-scope.service';

export interface StoreInput {
  code?: string;
  name?: string;
  phone?: string;
  region?: string;
  address?: string;
  lat?: number;
  lng?: number;
  businessHours?: Record<string, unknown>;
  pickupEnabled?: boolean;
  deliveryEnabled?: boolean;
  deliveryFeeCents?: number;
  freeDeliveryThresholdCents?: number;
  deliverySlots?: string[];
  deliveryCutoff?: string;
  maxOrdersPerSlot?: number;
  pickupCompleteDays?: number;
  notice?: string;
  status?: 'ACTIVE' | 'DISABLED';
  sort?: number;
  deliveryRegions?: string[];
}

const STORE_SELECT = {
  id: true,
  code: true,
  name: true,
  phone: true,
  region: true,
  address: true,
  lat: true,
  lng: true,
  businessHours: true,
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryFeeCents: true,
  freeDeliveryThresholdCents: true,
  deliverySlots: true,
  deliveryCutoff: true,
  maxOrdersPerSlot: true,
  pickupCompleteDays: true,
  notice: true,
  status: true,
  sort: true,
  createdAt: true,
  updatedAt: true,
  deliveryRegions: {
    select: { regionName: true },
    orderBy: { regionName: 'asc' as const },
  },
} as const;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

@Injectable()
export class StoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: StoreScopeService,
  ) {}

  /** 小程序：启用中的门店，可按区域与履约能力筛选 */
  async listPublic(input: { region?: string; capability?: 'PICKUP' | 'DELIVERY' }) {
    const items = await this.prisma.store.findMany({
      where: {
        status: 'ACTIVE',
        ...(input.region?.trim() ? { region: { contains: input.region.trim() } } : {}),
        ...(input.capability === 'PICKUP' ? { pickupEnabled: true } : {}),
        ...(input.capability === 'DELIVERY' ? { deliveryEnabled: true } : {}),
      },
      select: STORE_SELECT,
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    return { items: items.map((item) => this.view(item)) };
  }

  async detailPublic(id: string) {
    const store = await this.prisma.store.findFirst({
      where: { id, status: 'ACTIVE' },
      select: STORE_SELECT,
    });
    if (!store) throw new NotFoundException('门店不存在或已停用');
    return this.view(store);
  }

  /** 后台：总部全量，门店账号只返回授权门店 */
  async listAdmin(user: AuthUser, status?: string) {
    const scope = await this.scopes.resolve(user);
    const where = {
      ...(scope.all ? {} : { id: { in: scope.storeIds } }),
      ...(status ? { status } : {}),
    };
    const items = await this.prisma.store.findMany({
      where,
      select: STORE_SELECT,
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    return { items: items.map((item) => this.view(item)) };
  }

  async mine(user: AuthUser) {
    return this.listAdmin(user, 'ACTIVE');
  }

  async detailAdmin(user: AuthUser, id: string) {
    const scope = await this.scopes.resolve(user);
    this.scopes.assertAccess(scope, id);
    return this.findOne(id);
  }

  async create(input: StoreInput) {
    const deliveryRegions = this.regions(input.deliveryRegions) ?? [];
    try {
      const store = await this.prisma.store.create({
        data: {
          code: this.code(input.code),
          name: this.text(input.name, '门店名称', 40),
          phone: this.optionalText(input.phone, '联系电话', 20),
          region: this.text(input.region, '所在区域', 60),
          address: this.text(input.address, '详细地址', 120),
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          businessHours: (input.businessHours ?? {}) as never,
          pickupEnabled: input.pickupEnabled ?? false,
          deliveryEnabled: input.deliveryEnabled ?? false,
          deliveryFeeCents: this.cents(input.deliveryFeeCents, '配送费'),
          freeDeliveryThresholdCents: this.cents(
            input.freeDeliveryThresholdCents,
            '免配送门槛',
          ),
          deliverySlots: (input.deliverySlots ?? []) as never,
          deliveryCutoff: this.cutoff(input.deliveryCutoff),
          maxOrdersPerSlot: this.nonNegative(input.maxOrdersPerSlot, '每时段最大单量'),
          pickupCompleteDays: this.days(input.pickupCompleteDays),
          notice: this.optionalText(input.notice, '门店公告', 200),
          status: input.status ?? 'ACTIVE',
          sort: this.nonNegative(input.sort, '排序'),
          deliveryRegions: {
            create: deliveryRegions.map((regionName) => ({ regionName })),
          },
        },
        select: STORE_SELECT,
      });
      return this.view(store);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('门店编码已存在');
      throw err;
    }
  }

  async update(id: string, input: StoreInput) {
    await this.findOne(id);

    const deliveryRegions = this.regions(input.deliveryRegions);
    try {
      const store = await this.prisma.store.update({
        where: { id },
        data: {
          ...(input.code !== undefined ? { code: this.code(input.code) } : {}),
          ...(input.name !== undefined ? { name: this.text(input.name, '门店名称', 40) } : {}),
          ...(input.phone !== undefined
            ? { phone: this.optionalText(input.phone, '联系电话', 20) }
            : {}),
          ...(input.region !== undefined
            ? { region: this.text(input.region, '所在区域', 60) }
            : {}),
          ...(input.address !== undefined
            ? { address: this.text(input.address, '详细地址', 120) }
            : {}),
          ...(input.lat !== undefined ? { lat: input.lat } : {}),
          ...(input.lng !== undefined ? { lng: input.lng } : {}),
          ...(input.businessHours !== undefined
            ? { businessHours: input.businessHours as never }
            : {}),
          ...(input.pickupEnabled !== undefined ? { pickupEnabled: input.pickupEnabled } : {}),
          ...(input.deliveryEnabled !== undefined
            ? { deliveryEnabled: input.deliveryEnabled }
            : {}),
          ...(input.deliveryFeeCents !== undefined
            ? { deliveryFeeCents: this.cents(input.deliveryFeeCents, '配送费') }
            : {}),
          ...(input.freeDeliveryThresholdCents !== undefined
            ? {
                freeDeliveryThresholdCents: this.cents(
                  input.freeDeliveryThresholdCents,
                  '免配送门槛',
                ),
              }
            : {}),
          ...(input.deliverySlots !== undefined
            ? { deliverySlots: input.deliverySlots as never }
            : {}),
          ...(input.deliveryCutoff !== undefined
            ? { deliveryCutoff: this.cutoff(input.deliveryCutoff) }
            : {}),
          ...(input.maxOrdersPerSlot !== undefined
            ? { maxOrdersPerSlot: this.nonNegative(input.maxOrdersPerSlot, '每时段最大单量') }
            : {}),
          ...(input.pickupCompleteDays !== undefined
            ? { pickupCompleteDays: this.days(input.pickupCompleteDays) }
            : {}),
          ...(input.notice !== undefined
            ? { notice: this.optionalText(input.notice, '门店公告', 200) }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.sort !== undefined ? { sort: this.nonNegative(input.sort, '排序') } : {}),
          ...(deliveryRegions !== null
            ? {
                deliveryRegions: {
                  deleteMany: {},
                  create: deliveryRegions.map((regionName) => ({ regionName })),
                },
              }
            : {}),
        },
        select: STORE_SELECT,
      });
      return this.view(store);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('门店编码已存在');
      throw err;
    }
  }

  /** 门店看板 v1：今日经营、待履约与库存预警 */
  async dashboard(user: AuthUser, id: string) {
    const scope = await this.scopes.resolve(user);
    this.scopes.assertAccess(scope, id);

    const store = await this.prisma.store.findUnique({
      where: { id },
      select: { id: true, name: true, status: true },
    });
    if (!store) throw new NotFoundException('门店不存在');

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const paidWhere = {
      storeId: id,
      paidAt: { gte: start },
      status: { notIn: ['PENDING_PAYMENT', 'CLOSED'] as never[] },
    };
    // Refund 暂未建 Order 关联，先取本店订单 id 再聚合
    const storeOrderIds = (
      await this.prisma.order.findMany({ where: { storeId: id }, select: { id: true } })
    ).map((order) => order.id);

    const [paid, refunds, pendingPickup, pendingDelivery, stockRows, todayDeliveries, activeDeliveries] =
      await Promise.all([
      this.prisma.order.aggregate({
        where: paidWhere,
        _count: { _all: true },
        _sum: { payableCents: true },
      }),
      this.prisma.refund.aggregate({
        where: {
          status: 'SUCCESS',
          refundedAt: { gte: start },
          orderId: { in: storeOrderIds },
        },
        _count: { _all: true },
        _sum: { amountCents: true },
      }),
      this.prisma.order.count({
        where: { storeId: id, fulfillmentType: 'PICKUP', status: 'PAID' },
      }),
      this.prisma.order.count({
        where: { storeId: id, fulfillmentType: 'DELIVERY', status: 'PAID' },
      }),
      this.prisma.storeSku.findMany({
        where: { storeId: id },
        select: {
          skuId: true,
          stock: true,
          reserved: true,
          safetyStock: true,
          sku: {
            select: {
              code: true,
              product: { select: { title: true } },
            },
          },
        },
      }),
      this.prisma.delivery.findMany({
        where: { storeId: id, createdAt: { gte: start } },
        select: { status: true, createdAt: true, acceptedAt: true, deliveredAt: true },
      }),
      this.prisma.delivery.findMany({
        where: { storeId: id, status: { in: ['PENDING', 'ACCEPTED'] } },
        select: { status: true, createdAt: true, acceptedAt: true },
      }),
    ]);

    const avgMinutes = (values: number[]): number | null =>
      values.length
        ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
        : null;
    const acceptDurations = todayDeliveries
      .filter((row) => row.acceptedAt)
      .map(
        (row) =>
          (row.acceptedAt!.getTime() - row.createdAt.getTime()) / 60_000,
      );
    const deliverDurations = todayDeliveries
      .filter((row) => row.deliveredAt && row.acceptedAt)
      .map(
        (row) =>
          (row.deliveredAt!.getTime() - row.acceptedAt!.getTime()) / 60_000,
      );
    const overdueCount = activeDeliveries.filter((row) =>
      isDeliveryOverdue({
        status: row.status,
        createdAt: row.createdAt,
        acceptedAt: row.acceptedAt,
      }),
    ).length;

    const warnings = stockRows
      .map((row) => ({
        skuId: row.skuId,
        code: row.sku.code,
        title: row.sku.product.title,
        available: Math.max(row.stock - row.reserved, 0),
        safetyStock: row.safetyStock,
      }))
      .filter((row) => row.available <= row.safetyStock);

    return {
      store,
      range: { start, end: new Date() },
      today: {
        paidOrders: paid._count._all,
        gmvCents: paid._sum.payableCents ?? 0,
        refundOrders: refunds._count._all,
        refundCents: refunds._sum.amountCents ?? 0,
      },
      pending: {
        pickupOrders: pendingPickup,
        deliveryOrders: pendingDelivery,
      },
      delivery: {
        avgAcceptMinutes: avgMinutes(acceptDurations),
        avgDeliverMinutes: avgMinutes(deliverDurations),
        overdueCount,
      },
      stock: {
        warningCount: warnings.length,
        warnings: warnings.slice(0, 10),
      },
    };
  }

  /** 门店被订单引用，删除改为停用，保留历史归属 */
  async disable(id: string) {
    await this.findOne(id);
    await this.prisma.store.update({ where: { id }, data: { status: 'DISABLED' } });
    return { disabled: true };
  }

  private async findOne(id: string) {
    const store = await this.prisma.store.findUnique({ where: { id }, select: STORE_SELECT });
    if (!store) throw new NotFoundException('门店不存在');
    return this.view(store);
  }

  private view<T extends { deliveryRegions: { regionName: string }[] }>(row: T) {
    const { deliveryRegions, ...rest } = row;
    return { ...rest, deliveryRegions: deliveryRegions.map((item) => item.regionName) };
  }

  private code(value?: string): string {
    const code = (value ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(code)) {
      throw new BadRequestException('门店编码需为 2-20 位大写字母、数字、下划线或连字符');
    }
    return code;
  }

  private text(value: string | undefined, field: string, max: number): string {
    const text = (value ?? '').trim();
    if (!text) throw new BadRequestException(`${field}不能为空`);
    if (text.length > max) throw new BadRequestException(`${field}不能超过 ${max} 个字符`);
    return text;
  }

  private optionalText(
    value: string | undefined,
    field: string,
    max: number,
  ): string | null {
    const text = (value ?? '').trim();
    if (!text) return null;
    if (text.length > max) throw new BadRequestException(`${field}不能超过 ${max} 个字符`);
    return text;
  }

  private cents(value: number | undefined, field: string): number {
    if (value === undefined) return 0;
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${field}必须为非负整数（分）`);
    }
    return value;
  }

  private nonNegative(value: number | undefined, field: string): number {
    if (value === undefined) return 0;
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${field}必须为非负整数`);
    }
    return value;
  }

  private days(value?: number): number {
    if (value === undefined) return 7;
    if (!Number.isInteger(value) || value < 1 || value > 90) {
      throw new BadRequestException('自提完成天数需为 1-90 的整数');
    }
    return value;
  }

  private cutoff(value?: string): string | null {
    const cutoff = (value ?? '').trim();
    if (!cutoff) return null;
    if (!TIME_PATTERN.test(cutoff)) {
      throw new BadRequestException('截单时间格式需为 HH:mm');
    }
    return cutoff;
  }

  /** 返回 null 表示本次不修改配送区域 */
  private regions(value?: string[]): string[] | null {
    if (value === undefined) return null;
    const unique = [...new Set(value.map((item) => item.trim()).filter(Boolean))];
    if (unique.length > 50) throw new BadRequestException('配送区县不能超过 50 个');
    return unique;
  }
}
