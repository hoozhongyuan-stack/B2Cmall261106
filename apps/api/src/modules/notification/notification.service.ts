import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.module';
import { IntegrationService } from '../integration/integration.service';
import { WechatSubscribeClient } from './wechat-subscribe.client';

export const NOTIFICATION_SCENES = [
  'orderPaid',
  'orderShipped',
  'refundResult',
  'pickupReady',
  'pickupExpiring',
  'deliveryAccepted',
  'deliveryDone',
] as const;
export type NotificationScene = (typeof NOTIFICATION_SCENES)[number];

const SCENE_CODE: Record<NotificationScene, string> = {
  orderPaid: 'ORDER_PAID',
  orderShipped: 'ORDER_SHIPPED',
  refundResult: 'REFUND_RESULT',
  pickupReady: 'PICKUP_READY',
  pickupExpiring: 'PICKUP_EXPIRING',
  deliveryAccepted: 'DELIVERY_ACCEPTED',
  deliveryDone: 'DELIVERY_DONE',
};

/** 未配置映射时使用的默认微信模板字段（需与后台模板一致） */
const DEFAULT_FIELDS: Record<NotificationScene, Record<string, string>> = {
  orderPaid: {
    character_string1: 'orderNo',
    amount2: 'payable',
    thing3: 'items',
    time4: 'paidAt',
  },
  orderShipped: {
    character_string1: 'orderNo',
    character_string2: 'trackingNo',
    thing3: 'expressName',
    time4: 'shippedAt',
  },
  refundResult: {
    character_string1: 'refundNo',
    thing2: 'items',
    amount3: 'amount',
    phrase4: 'status',
    time5: 'refundedAt',
  },
  pickupReady: {
    character_string1: 'orderNo',
    character_string2: 'pickupCode',
    thing3: 'storeName',
    time4: 'pickupAt',
  },
  pickupExpiring: {
    character_string1: 'orderNo',
    thing2: 'storeName',
    time3: 'expiresAt',
  },
  deliveryAccepted: {
    character_string1: 'orderNo',
    thing2: 'storeName',
    thing3: 'courierName',
    character_string4: 'courierPhone',
    time5: 'acceptedAt',
  },
  deliveryDone: {
    character_string1: 'orderNo',
    thing2: 'storeName',
    time3: 'deliveredAt',
  },
};

/** 重试间隔（分钟），最多发送 5 次 */
const RETRY_DELAYS_MIN = [1, 2, 5, 15, 60];
const MAX_ATTEMPTS = 5;
const FLUSH_INTERVAL_MS = 30_000;

type NotificationLogRow = {
  id: string;
  templateId: string;
  openid: string | null;
  page: string | null;
  dataJson: unknown;
  attempts: number;
};

@Injectable()
export class NotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly integration: IntegrationService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.flushPending().catch((err) => this.logger.error('订阅消息发送任务失败', err));
    }, FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /* ---------------- 入队 ---------------- */

  async enqueueOrderPaid(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, user: true },
    });
    if (!order) return;

    await this.enqueue({
      scene: 'orderPaid',
      dedupeKey: `${SCENE_CODE.orderPaid}:${order.orderNo}`,
      userId: order.userId,
      openid: order.user.openid,
      page: `/pages/order-detail/index?id=${order.id}`,
      vars: {
        orderNo: order.orderNo,
        payable: yuan(order.payableCents),
        items: order.items[0]?.title ?? '商品',
        paidAt: formatTime(order.paidAt ?? new Date()),
      },
    });
  }

  async enqueueOrderShipped(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { shipment: true, user: true },
    });
    if (!order?.shipment) return;

    await this.enqueue({
      scene: 'orderShipped',
      dedupeKey: `${SCENE_CODE.orderShipped}:${order.orderNo}`,
      userId: order.userId,
      openid: order.user.openid,
      page: `/pages/order-detail/index?id=${order.id}`,
      vars: {
        orderNo: order.orderNo,
        trackingNo: order.shipment.trackingNo,
        expressName: order.shipment.expressName,
        shippedAt: formatTime(order.shipment.shippedAt),
      },
    });
  }

  async enqueuePickupReady(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { store: true, user: true },
    });
    if (!order || order.fulfillmentType !== 'PICKUP' || !order.pickupCode) return;

    await this.enqueue({
      scene: 'pickupReady',
      dedupeKey: `${SCENE_CODE.pickupReady}:${order.orderNo}`,
      userId: order.userId,
      openid: order.user.openid,
      page: `/pages/order-detail/index?id=${order.id}`,
      vars: {
        orderNo: order.orderNo,
        pickupCode: order.pickupCode,
        storeName: order.store?.name ?? '门店',
        pickupAt: formatTime(order.pickupAt ?? new Date()),
      },
    });
  }

  async enqueuePickupExpiring(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { store: true, user: true },
    });
    if (
      !order ||
      order.fulfillmentType !== 'PICKUP' ||
      order.status !== 'PAID' ||
      !order.pickupCodeExpiresAt
    ) {
      return;
    }
    await this.enqueue({
      scene: 'pickupExpiring',
      dedupeKey: `${SCENE_CODE.pickupExpiring}:${order.orderNo}`,
      userId: order.userId,
      openid: order.user.openid,
      page: `/pages/order-detail/index?id=${order.id}`,
      vars: {
        orderNo: order.orderNo,
        storeName: order.store?.name ?? '门店',
        expiresAt: formatTime(order.pickupCodeExpiresAt),
      },
    });
  }

  async enqueueDeliveryAccepted(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { order: { include: { user: true } }, store: true },
    });
    if (!delivery?.acceptedAt) return;

    await this.enqueue({
      scene: 'deliveryAccepted',
      dedupeKey: `${SCENE_CODE.deliveryAccepted}:${delivery.order.orderNo}`,
      userId: delivery.order.userId,
      openid: delivery.order.user.openid,
      page: `/pages/order-detail/index?id=${delivery.orderId}`,
      vars: {
        orderNo: delivery.order.orderNo,
        storeName: delivery.store.name,
        courierName: delivery.courierName ?? '配送员',
        courierPhone: delivery.courierPhone ?? '',
        acceptedAt: formatTime(delivery.acceptedAt),
      },
    });
  }

  async enqueueDeliveryDone(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { order: { include: { user: true } }, store: true },
    });
    if (!delivery?.deliveredAt) return;

    await this.enqueue({
      scene: 'deliveryDone',
      dedupeKey: `${SCENE_CODE.deliveryDone}:${delivery.order.orderNo}`,
      userId: delivery.order.userId,
      openid: delivery.order.user.openid,
      page: `/pages/order-detail/index?id=${delivery.orderId}`,
      vars: {
        orderNo: delivery.order.orderNo,
        storeName: delivery.store.name,
        deliveredAt: formatTime(delivery.deliveredAt),
      },
    });
  }

  async enqueueRefundResult(refundId: string): Promise<void> {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        afterSale: {
          include: { orderItem: true, order: { include: { user: true } } },
        },
      },
    });
    if (!refund) return;

    await this.enqueue({
      scene: 'refundResult',
      dedupeKey: `${SCENE_CODE.refundResult}:${refund.refundNo}`,
      userId: refund.afterSale.userId,
      openid: refund.afterSale.order.user.openid,
      page: `/pages/after-sale/detail/index?id=${refund.afterSaleId}`,
      vars: {
        refundNo: refund.refundNo,
        items: refund.afterSale.orderItem.title,
        amount: yuan(refund.amountCents),
        status: refund.status === 'SUCCESS' ? '退款成功' : '退款失败',
        refundedAt: formatTime(refund.refundedAt ?? new Date()),
      },
    });
  }

  private async enqueue(input: {
    scene: NotificationScene;
    dedupeKey: string;
    userId: string;
    openid?: string | null;
    page: string;
    vars: Record<string, string>;
  }): Promise<void> {
    const { templates, fields } = await this.integration.subscribeTemplateConfig();
    const templateId = templates[input.scene];
    const openid = input.openid ?? null;

    const missing = !templateId
      ? '未配置订阅消息模板'
      : !openid
        ? '用户缺少 openid'
        : null;

    try {
      await this.prisma.notificationLog.create({
        data: {
          dedupeKey: input.dedupeKey,
          scene: SCENE_CODE[input.scene],
          templateId: templateId ?? '',
          userId: input.userId,
          openid,
          page: input.page,
          dataJson: this.buildData(input.scene, input.vars, fields) as never,
          status: missing ? 'SKIPPED' : 'PENDING',
          error: missing,
          nextRetryAt: missing ? null : new Date(),
        },
      });
    } catch (err) {
      // 同一业务事件重复触发：唯一键冲突直接忽略
      if ((err as { code?: string }).code === 'P2002') return;
      throw err;
    }
  }

  /* ---------------- 发送 ---------------- */

  /** 发送所有到期的待发通知；返回本次结果统计 */
  async flushPending(): Promise<{ sent: number; retried: number; failed: number }> {
    const due = await this.prisma.notificationLog.findMany({
      where: {
        status: 'PENDING',
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
      },
      orderBy: { nextRetryAt: 'asc' },
      take: 20,
    });

    const stats = { sent: 0, retried: 0, failed: 0 };
    for (const log of due) {
      const result = await this.deliver(log);
      if (result === 'sent') stats.sent += 1;
      else if (result === 'failed') stats.failed += 1;
      else stats.retried += 1;
    }
    return stats;
  }

  /** 立即重试一条失败/跳过记录 */
  async retry(id: string) {
    const log = await this.prisma.notificationLog.findUnique({ where: { id } });
    if (!log) throw new NotFoundException('通知记录不存在');
    if (log.status === 'SENT') throw new ConflictException('该通知已发送成功');

    return this.prisma.notificationLog.update({
      where: { id },
      data: { status: 'PENDING', attempts: 0, nextRetryAt: new Date(), error: null },
      select: { id: true, status: true },
    });
  }

  /** 后台测试发送：使用订单支付模板与样例数据 */
  async sendTest(userId?: string) {
    const { templates, fields } = await this.integration.subscribeTemplateConfig();
    if (!templates.orderPaid) {
      throw new BadRequestException('请先在集成配置中填写订单支付通知模板 ID');
    }

    const user = userId
      ? await this.prisma.user.findUnique({ where: { id: userId } })
      : await this.prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!user) throw new NotFoundException('没有可发送的用户');
    if (!user.openid) throw new BadRequestException('该用户缺少 openid，无法发送订阅消息');

    const log = await this.prisma.notificationLog.create({
      data: {
        dedupeKey: `TEST:${randomUUID()}`,
        scene: SCENE_CODE.orderPaid,
        templateId: templates.orderPaid,
        userId: user.id,
        openid: user.openid,
        page: '/pages/orders/index',
        dataJson: this.buildData(
          'orderPaid',
          {
            orderNo: `TEST${Date.now()}`,
            payable: yuan(1),
            items: '测试商品',
            paidAt: formatTime(new Date()),
          },
          fields,
        ) as never,
        status: 'PENDING',
        nextRetryAt: new Date(),
      },
    });

    const result = await this.deliver(log);
    const latest = await this.prisma.notificationLog.findUnique({
      where: { id: log.id },
      select: { error: true },
    });
    return { id: log.id, ok: result === 'sent', error: latest?.error ?? undefined };
  }

  /**
   * 实际调用微信发送。成功 → SENT；可重试失败 → PENDING + 退避；超出次数 → FAILED。
   * 返回 retried 表示本次失败但后续会重试。
   */
  private async deliver(log: NotificationLogRow): Promise<'sent' | 'retried' | 'failed'> {
    const templateId = log.templateId;
    const openid = log.openid;
    if (!templateId || !openid) {
      await this.prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'SKIPPED', error: !templateId ? '未配置订阅消息模板' : '用户缺少 openid' },
      });
      return 'failed';
    }

    try {
      const credentials = await this.integration.miniappCredentials();
      const client = new WechatSubscribeClient(credentials);
      const result = await client.send({
        openid,
        templateId,
        page: log.page ?? undefined,
        data: (log.dataJson ?? {}) as Record<string, { value: string }>,
      });

      if (result.ok) {
        await this.prisma.notificationLog.update({
          where: { id: log.id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            error: null,
            responseJson: toJson(result.raw) as never,
          },
        });
        return 'sent';
      }
      return this.scheduleRetry(
        log,
        `微信返回 ${result.errcode ?? ''}：${result.errmsg ?? '发送失败'}`,
      );
    } catch (err) {
      return this.scheduleRetry(log, err instanceof Error ? err.message : '发送失败');
    }
  }

  private async scheduleRetry(
    log: NotificationLogRow,
    error: string,
  ): Promise<'retried' | 'failed'> {
    const attempts = log.attempts + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    await this.prisma.notificationLog.update({
      where: { id: log.id },
      data: {
        attempts,
        error: error.slice(0, 500),
        ...(failed
          ? { status: 'FAILED', nextRetryAt: null }
          : {
              status: 'PENDING',
              nextRetryAt: new Date(
                Date.now() + RETRY_DELAYS_MIN[Math.min(attempts - 1, 4)] * 60_000,
              ),
            }),
      },
    });
    if (failed) this.logger.warn(`订阅消息发送失败 ${log.id}：${error}`);
    return failed ? 'failed' : 'retried';
  }

  /* ---------------- 查询 ---------------- */

  async listLogs(input: { status?: string; scene?: string; page?: number; pageSize?: number }) {
    const currentPage = Math.max(input.page ?? 1, 1);
    const size = Math.min(Math.max(input.pageSize ?? 20, 1), 100);
    const where = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.scene ? { scene: input.scene } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.notificationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (currentPage - 1) * size,
        take: size,
      }),
      this.prisma.notificationLog.count({ where }),
    ]);

    return {
      total,
      page: currentPage,
      pageSize: size,
      items: items.map((log) => ({
        id: log.id,
        scene: log.scene,
        templateId: log.templateId,
        userId: log.userId,
        status: log.status,
        attempts: log.attempts,
        error: log.error,
        createdAt: log.createdAt,
        sentAt: log.sentAt,
        nextRetryAt: log.nextRetryAt,
      })),
    };
  }

  /** 公开给小程序：仅返回已配置的模板 ID */
  async configuredTemplates(): Promise<{
    templates: Partial<Record<NotificationScene, string>>;
  }> {
    const { templates } = await this.integration.subscribeTemplateConfig();
    const result: Partial<Record<NotificationScene, string>> = {};
    for (const scene of NOTIFICATION_SCENES) {
      if (templates[scene]) result[scene] = templates[scene];
    }
    return { templates: result };
  }

  /* ---------------- 内部 ---------------- */

  private buildData(
    scene: NotificationScene,
    vars: Record<string, string>,
    fields: Record<string, Record<string, string>>,
  ): Record<string, { value: string }> {
    const mapping = fields[scene] ?? DEFAULT_FIELDS[scene];
    const data: Record<string, { value: string }> = {};
    for (const [field, variable] of Object.entries(mapping)) {
      const value = vars[variable] ?? '';
      if (!value) continue;
      data[field] = { value: truncate(field, value) };
    }
    return data;
  }
}

function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function formatTime(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(
    value.getHours(),
  )}:${pad(value.getMinutes())}`;
}

/** 微信字段长度限制：thing 20、character_string 32、phrase 5 */
function truncate(field: string, value: string): string {
  if (field.startsWith('thing')) return value.slice(0, 20);
  if (field.startsWith('character_string')) return value.slice(0, 32);
  if (field.startsWith('phrase')) return value.slice(0, 5);
  return value;
}

function toJson(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return undefined;
  }
}
