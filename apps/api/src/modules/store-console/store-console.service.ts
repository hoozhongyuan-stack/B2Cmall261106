import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.module';
import type { AuthUser } from '../../common/auth.guards';
import { PickupService } from '../pickup/pickup.service';
import { DeliveryService } from '../delivery/delivery.service';
import { StoreService, type StoreInput } from '../store/store.service';
import { StoreStockService } from '../store/store-stock.service';

export interface StoreConsoleStore {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  address: string;
  region: string;
  status: string;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  notice: string | null;
  temporarilyClosedUntil: Date | null;
  temporaryClosureNote: string | null;
  manager: { id: string; nickname: string | null; phone: string | null } | null;
}

interface StoreManagerContext {
  store: StoreConsoleStore;
}

/**
 * 门店小程序「门店中心」：以 Store.managerUserId 作为唯一身份来源。
 * 不依赖 AdminUser / AdminStore，PC 门店账号已停用。
 */
@Injectable()
export class StoreConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pickups: PickupService,
    private readonly deliveries: DeliveryService,
    private readonly stores: StoreService,
    private readonly stock: StoreStockService,
  ) {}

  /** 非门店负责人返回 { hasStore: false }，小程序据此隐藏入口而不是报错 */
  async context(userId: string) {
    const store = await this.prisma.store.findUnique({
      where: { managerUserId: userId },
      select: {
        id: true,
        name: true,
        code: true,
        phone: true,
        address: true,
        region: true,
        status: true,
        pickupEnabled: true,
        deliveryEnabled: true,
        notice: true,
        temporarilyClosedUntil: true,
        temporaryClosureNote: true,
        manager: { select: { id: true, nickname: true, phone: true } },
      },
    });
    if (!store) return { hasStore: false, store: null };
    return { hasStore: true, store };
  }

  /** 工作台：待办数字 + 今日经营 */
  async summary(userId: string) {
    const ctx = await this.requireStore(userId);
    const storeId = ctx.store.id;
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const [pendingPickup, pendingDelivery, delivering, todayOrders, stockRows] = await Promise.all([
      this.prisma.order.count({
        where: { storeId, fulfillmentType: 'PICKUP', status: 'PAID', pickupCode: { not: null } },
      }),
      this.prisma.delivery.count({ where: { storeId, status: 'PENDING' } }),
      this.prisma.delivery.count({ where: { storeId, status: 'ACCEPTED' } }),
      this.prisma.order.aggregate({
        where: {
          storeId,
          paidAt: { gte: start },
          status: { notIn: ['PENDING_PAYMENT', 'CLOSED'] as never[] },
        },
        _count: { _all: true },
        _sum: { payableCents: true },
      }),
      this.prisma.storeSku.findMany({
        where: { storeId },
        select: { stock: true, reserved: true, safetyStock: true },
      }),
    ]);

    return {
      store: ctx.store,
      todo: {
        pendingPickup,
        pendingDelivery,
        delivering,
        stockWarnings: stockRows.filter((row) => row.stock - row.reserved <= row.safetyStock).length,
      },
      today: {
        paidOrders: todayOrders._count._all,
        paidCents: todayOrders._sum.payableCents ?? 0,
      },
    };
  }

  async verifyPickup(userId: string, code: string) {
    const ctx = await this.requireStore(userId);
    const actor = { id: userId, name: ctx.store.manager?.nickname ?? '门店负责人' };
    return this.pickups.verifyForStore(ctx.store.id, code, actor);
  }

  async listDeliveries(
    userId: string,
    query: { status?: string; date?: string; page?: number; pageSize?: number },
  ) {
    const ctx = await this.requireStore(userId);
    return this.deliveries.listForStore(ctx.store.id, query);
  }

  async acceptDelivery(
    userId: string,
    id: string,
    input: { courierName?: string; courierPhone?: string },
  ) {
    const ctx = await this.requireStore(userId);
    return this.deliveries.accept(this.actor(userId, ctx), id, input, { storeId: ctx.store.id });
  }

  async deliverOrder(userId: string, id: string) {
    const ctx = await this.requireStore(userId);
    return this.deliveries.deliver(this.actor(userId, ctx), id, { storeId: ctx.store.id });
  }

  /** 门店库存：支持关键词与「只看预警」筛选，返回预警总数 */
  async listStock(
    userId: string,
    query: { keyword?: string; warning?: boolean; page?: number; pageSize?: number },
  ) {
    const ctx = await this.requireStore(userId);
    return this.stock.listForStore(ctx.store.id, {
      keyword: query.keyword,
      warning: query.warning,
      page: String(query.page ?? 1),
      pageSize: String(query.pageSize ?? 20),
    });
  }

  /** 门店库存：调整可售库存 / 安全库存 */
  async adjustStock(
    userId: string,
    skuId: string,
    input: { stock?: number; safetyStock?: number },
  ) {
    const ctx = await this.requireStore(userId);
    return this.stock.adjustForStore(ctx.store.id, skuId, input, userId);
  }

  /** 营业设置：营业时间、公告与自提/配送开关 */
  async settings(userId: string) {
    const ctx = await this.requireStore(userId);
    return this.stores.detailPublic(ctx.store.id);
  }

  async updateSettings(
    userId: string,
    input: {
      notice?: string;
      businessHours?: Record<string, unknown>;
      pickupEnabled?: boolean;
      deliveryEnabled?: boolean;
    },
  ) {
    const ctx = await this.requireStore(userId);
    const patch: StoreInput = {
      ...(input.notice !== undefined ? { notice: input.notice } : {}),
      ...(input.businessHours !== undefined
        ? { businessHours: this.businessHours(input.businessHours) }
        : {}),
      ...(input.pickupEnabled !== undefined ? { pickupEnabled: input.pickupEnabled } : {}),
      ...(input.deliveryEnabled !== undefined ? { deliveryEnabled: input.deliveryEnabled } : {}),
    };
    return this.stores.update(ctx.store.id, patch);
  }

  /** 移动端门店看板：今日经营、待履约、配送时效与库存预警 */
  async dashboard(userId: string) {
    const ctx = await this.requireStore(userId);
    return this.stores.dashboardForStore(ctx.store.id);
  }

  /** 临时打烊 / 恢复营业；until 为空表示立即恢复 */
  async setClosure(userId: string, input: { until?: string | null; note?: string }) {
    const ctx = await this.requireStore(userId);
    if (input.until === null || input.until === '') {
      return this.stores.temporaryClosure(ctx.store.id, null);
    }
    if (!input.until) throw new BadRequestException('请选择恢复营业时间');
    const until = new Date(input.until);
    if (Number.isNaN(until.getTime())) throw new BadRequestException('恢复营业时间格式不正确');
    return this.stores.temporaryClosure(ctx.store.id, until, input.note ?? null);
  }

  private async requireStore(userId: string): Promise<StoreManagerContext> {
    const ctx = (await this.context(userId)) as { hasStore: boolean; store: StoreConsoleStore | null };
    if (!ctx.store) throw new NotFoundException('当前账号未关联门店，请联系总部');
    if (ctx.store.status !== 'ACTIVE') {
      throw new ForbiddenException('门店已停用，请联系总部');
    }
    return { store: ctx.store };
  }

  /** 复用后台服务的操作日志字段；门店员工不是 AdminUser，用占位账号 */
  private actor(userId: string, ctx: StoreManagerContext): AuthUser {
    return {
      sub: userId,
      account: 'store-console',
      role: 'STORE',
      name: ctx.store.manager?.nickname ?? ctx.store.name,
    };
  }

  /** 营业时间：{ mon: [['09:00','18:00']], ... }，空数组表示休息 */
  private businessHours(value: Record<string, unknown>): Record<string, string[][]> {
    const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const result: Record<string, string[][]> = {};
    for (const [day, ranges] of Object.entries(value)) {
      if (!weekdays.includes(day)) throw new BadRequestException(`未知的营业日：${day}`);
      if (!Array.isArray(ranges)) throw new BadRequestException('营业时间格式不正确');

      result[day] = ranges.map((range) => {
        if (!Array.isArray(range) || range.length !== 2) {
          throw new BadRequestException('营业时间格式不正确');
        }
        const [open, close] = range.map((item) => String(item).trim());
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(close)) {
          throw new BadRequestException('营业时间格式需为 09:00');
        }
        if (close <= open) throw new BadRequestException('营业结束时间需晚于开始时间');
        return [open, close];
      });
    }
    return result;
  }
}
