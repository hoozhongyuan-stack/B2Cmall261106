import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  canAfterSale,
  isBeforeShipment,
  nextAfterSaleStatus,
  nextStatus,
  type AfterSaleAction,
  type AfterSaleStatus,
  type OrderStatus,
} from '@shanye/shared';

import { PrismaService } from '../../prisma/prisma.module';
import { MockRefundProvider, type RefundProvider } from '../payment/refund.provider';
import { BalanceRefundProvider } from '../payment/balance-refund.provider';
import { WechatRefundProvider } from '../payment/wechat/wechat-refund.provider';
import { IntegrationService } from '../integration/integration.service';
import { CouponService } from '../coupon/coupon.service';
import { LoyaltyService } from '../member/loyalty.service';
import { NotificationService } from '../notification/notification.service';
import { StoreInventoryService } from '../store/store-inventory.service';

const REFUNDABLE_ORDER_STATUS: OrderStatus[] = ['PAID', 'SHIPPED', 'COMPLETED'];

@Injectable()
export class AfterSaleService {
  private readonly logger = new Logger(AfterSaleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coupons: CouponService,
    private readonly loyalty: LoyaltyService,
    private readonly integration: IntegrationService,
    private readonly notifications: NotificationService,
    private readonly storeInventory: StoreInventoryService,
  ) {}

  /**
   * 退款渠道按「该订单实际成功的支付单」选择，
   * 避免后台切换渠道后把 mock 订单误发到微信（或反之）。
   */
  private async refundProviderFor(orderId: string): Promise<{
    provider: RefundProvider;
    transactionId?: string;
  }> {
    const payment = await this.prisma.payment.findFirst({
      where: { orderId, status: 'SUCCESS' },
      orderBy: { createdAt: 'desc' },
    });

    if (payment?.provider === 'wechat') {
      return {
        provider: new WechatRefundProvider(await this.integration.wechatPayConfig()),
        transactionId: payment.transactionId ?? undefined,
      };
    }
    if (payment?.provider === 'balance') {
      return { provider: new BalanceRefundProvider() };
    }
    return { provider: new MockRefundProvider() };
  }

  /** 买家提交售后：校验归属、期限、金额上限与是否重复申请 */
  async apply(
    userId: string,
    input: {
      orderItemId: string;
      type: 'REFUND_ONLY' | 'RETURN_REFUND';
      reason: string;
      description?: string;
      refundCents?: number;
      evidence?: string[];
    },
  ) {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: input.orderItemId, order: { userId } },
      include: { order: true, afterSale: true },
    });
    if (!item) throw new NotFoundException('订单商品不存在');
    if (item.afterSale) throw new ConflictException('该商品已有售后单');

    const config = await this.prisma.shopConfig.findFirst();
    const afterSaleDays = config?.afterSaleDays ?? 7;
    const baseTime = item.order.completedAt ?? item.order.shippedAt ?? item.order.paidAt;
    if (!baseTime) throw new ConflictException('订单尚未支付，无法申请售后');
    const deadline = new Date(baseTime.getTime() + afterSaleDays * 86_400_000);
    if (new Date() > deadline) {
      throw new ConflictException(`已超过 ${afterSaleDays} 天售后期`);
    }

    if (!REFUNDABLE_ORDER_STATUS.includes(item.order.status as OrderStatus)) {
      throw new ConflictException('当前订单状态不支持售后');
    }

    // 上限 = 行实付（已扣除会员折扣与券） - 已退金额；运费由整单退单独补
    const maxRefund = item.paidCents - item.refundedCents;
    const refundCents = input.refundCents ?? maxRefund;
    if (!Number.isInteger(refundCents) || refundCents <= 0) {
      throw new BadRequestException('退款金额必须为正整数分');
    }
    if (refundCents > maxRefund) {
      throw new BadRequestException(`退款金额不可超过 ¥${(maxRefund / 100).toFixed(2)}`);
    }

    const afterSaleNo = `AS${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;

    return this.prisma.$transaction(async (tx) => {
      // 订单进入售后中，记录申请前状态用于部分退款后恢复
      const moved = await tx.order.updateMany({
        where: {
          id: item.orderId,
          status: item.order.status,
          version: item.order.version,
        },
        data: {
          status: nextStatus(item.order.status as OrderStatus, 'refund_apply'),
          version: { increment: 1 },
          previousStatus: item.order.status as OrderStatus,
        },
      });
      if (moved.count !== 1) throw new ConflictException('订单状态已变化，请刷新');

      return tx.afterSale.create({
        data: {
          afterSaleNo,
          orderId: item.orderId,
          orderItemId: item.id,
          userId,
          type: input.type,
          reason: input.reason,
          description: input.description,
          evidenceJson: input.evidence ?? [],
          refundCents,
          previousOrderStatus: item.order.status as OrderStatus,
          status: 'APPLIED',
        },
      });
    });
  }

  async listMine(userId: string) {
    const list = await this.prisma.afterSale.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { order: true, orderItem: true },
      take: 50,
    });
    return { items: list.map((a) => this.view(a)) };
  }

  async viewMine(userId: string, id: string) {
    const record = await this.prisma.afterSale.findFirst({
      where: { id, userId },
      include: { order: true, orderItem: true, refund: true },
    });
    if (!record) throw new NotFoundException('售后单不存在');
    return this.view(record);
  }

  /** 买家寄回：填写寄回单号 */
  async shipBack(userId: string, id: string, trackingNo: string) {
    const record = await this.prisma.afterSale.findFirst({ where: { id, userId } });
    if (!record) throw new NotFoundException('售后单不存在');
    this.assertTransition(record.status as AfterSaleStatus, 'buyer_ship');

    return this.prisma.afterSale.update({
      where: { id },
      data: {
        status: nextAfterSaleStatus(record.status as AfterSaleStatus, 'buyer_ship'),
        buyerTrackingNo: trackingNo,
      },
    });
  }

  /** 买家撤销：仅在待审核阶段允许 */
  async cancelMine(userId: string, id: string) {
    const record = await this.prisma.afterSale.findFirst({ where: { id, userId } });
    if (!record) throw new NotFoundException('售后单不存在');
    this.assertTransition(record.status as AfterSaleStatus, 'cancel');

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: record.orderId } });
      if (order) {
        await tx.order.updateMany({
          where: { id: order.id, status: 'REFUNDING', version: order.version },
          data: {
            status: nextStatus('REFUNDING', 'refund_reject', {
              previousStatus: (record.previousOrderStatus ?? 'PAID') as OrderStatus,
            }),
            version: { increment: 1 },
            previousStatus: null,
          },
        });
      }
      return tx.afterSale.update({
        where: { id },
        data: {
          status: nextAfterSaleStatus(record.status as AfterSaleStatus, 'cancel'),
          finishedAt: new Date(),
        },
      });
    });
  }

  /* ---------------- 后台 ---------------- */

  async listAdmin(
    status?: string,
    page = 1,
    pageSize = 20,
    filters: { keyword?: string; type?: string; startDate?: string; endDate?: string } = {},
  ) {
    const currentPage = Math.max(page, 1);
    const size = Math.min(Math.max(pageSize, 1), 100);
    const search = filters.keyword?.trim();
    const createdAt =
      filters.startDate || filters.endDate
        ? {
            ...(filters.startDate
              ? { gte: new Date(`${filters.startDate}T00:00:00.000+08:00`) }
              : {}),
            ...(filters.endDate
              ? { lte: new Date(`${filters.endDate}T23:59:59.999+08:00`) }
              : {}),
          }
        : undefined;
    const where = {
      ...(status ? { status: status as AfterSaleStatus } : {}),
      ...(filters.type ? { type: filters.type as never } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(search
        ? {
            OR: [
              { afterSaleNo: { contains: search, mode: 'insensitive' as const } },
              { order: { orderNo: { contains: search, mode: 'insensitive' as const } } },
              { orderItem: { title: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const [list, total, counts] = await Promise.all([
      this.prisma.afterSale.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: { order: true, orderItem: true },
        skip: (currentPage - 1) * size,
        take: size,
      }),
      this.prisma.afterSale.count({ where }),
      this.prisma.afterSale.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    return {
      tabs: counts.map((c) => ({ status: c.status, count: c._count._all })),
      total,
      page: currentPage,
      pageSize: size,
      items: list.map((a) => this.view(a)),
    };
  }

  async detailAdmin(id: string) {
    const record = await this.prisma.afterSale.findUnique({
      where: { id },
      include: { order: true, orderItem: true, refund: true },
    });
    if (!record) throw new NotFoundException('售后单不存在');
    return this.view(record);
  }

  /** 审核通过与拒绝：仅退款直接进入退款中，退货退款进入待买家寄回 */
  async approve(id: string, action: 'approve_only_refund' | 'approve_return' | 'reject', rejectReason?: string) {
    const record = await this.prisma.afterSale.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('售后单不存在');

    if (action === 'reject') {
      if (!rejectReason?.trim()) throw new BadRequestException('拒绝时必须填写理由');
      this.assertTransition(record.status as AfterSaleStatus, 'reject');

      return this.prisma.$transaction(async (tx) => {
        await this.restoreOrder(tx, record);
        return tx.afterSale.update({
          where: { id },
          data: {
            status: 'REJECTED',
            rejectReason,
            finishedAt: new Date(),
          },
        });
      });
    }

    this.assertTransition(record.status as AfterSaleStatus, action);

    if (action === 'approve_return') {
      return this.prisma.afterSale.update({
        where: { id },
        data: { status: nextAfterSaleStatus(record.status as AfterSaleStatus, action) },
      });
    }

    // 仅退款：直接发起退款
    await this.prisma.afterSale.update({
      where: { id },
      data: { status: nextAfterSaleStatus(record.status as AfterSaleStatus, action) },
    });
    return this.executeRefund(id);
  }

  /** 商家确认收到退货并发起退款 */
  async receive(id: string) {
    const record = await this.prisma.afterSale.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('售后单不存在');
    this.assertTransition(record.status as AfterSaleStatus, 'seller_receive');

    await this.prisma.afterSale.update({
      where: { id },
      data: { status: nextAfterSaleStatus(record.status as AfterSaleStatus, 'seller_receive') },
    });
    return this.executeRefund(id);
  }

  /**
   * 执行退款：退款单幂等（refundNo 唯一，已成功则直接返回），
   * 成功后回写订单已退金额、条目已退金额，并按是否退完决定订单状态。
   */
  async executeRefund(afterSaleId: string) {
    const record = await this.prisma.afterSale.findUnique({
      where: { id: afterSaleId },
      include: { order: true, orderItem: true, refund: true },
    });
    if (!record) throw new NotFoundException('售后单不存在');
    if (record.refund?.status === 'SUCCESS') {
      return { refundNo: record.refund.refundNo, status: 'SUCCESS' };
    }

    const refundNo =
      record.refund?.refundNo ??
      `RF${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;

    const { provider: refundProvider, transactionId } = await this.refundProviderFor(
      record.orderId,
    );

    // PRD：整单退时含运费退，部分退时不退运费
    const siblings = await this.prisma.orderItem.findMany({
      where: { orderId: record.orderId },
      select: { id: true, paidCents: true, refundedCents: true },
    });
    const hasOtherUnrefunded = siblings.some(
      (s) => s.id !== record.orderItemId && s.refundedCents < s.paidCents,
    );
    const itemFullyRefunded =
      record.orderItem.refundedCents + record.refundCents >= record.orderItem.paidCents;
    const refundedGoods = siblings.reduce((sum, s) => sum + s.refundedCents, 0);
    const freightAlreadyRefunded = record.order.refundedCents - refundedGoods;
    const freightExtra =
      !hasOtherUnrefunded && itemFullyRefunded
        ? Math.max(record.order.freightCents - freightAlreadyRefunded, 0)
        : 0;
    const actualRefundCents = record.refundCents + freightExtra;

    const pending =
      record.refund ??
      (await this.prisma.refund.create({
        data: {
          refundNo,
          afterSaleId: record.id,
          orderId: record.orderId,
          amountCents: actualRefundCents,
          status: 'PENDING',
          provider: refundProvider.name,
        },
      }));

    // 累计退款不得超过实付
    const alreadyRefunded = record.order.refundedCents;
    if (alreadyRefunded + pending.amountCents > record.order.payableCents) {
      await this.prisma.refund.update({
        where: { id: pending.id },
        data: { status: 'FAILED', failReason: '累计退款超过实付金额' },
      });
      throw new ConflictException('累计退款金额超过订单实付');
    }

    const result = await refundProvider.refund({
      refundNo: pending.refundNo,
      orderNo: record.order.orderNo,
      amountCents: pending.amountCents,
      totalCents: record.order.payableCents,
      transactionId,
      reason: record.reason,
    });

    // 渠道受理但结果未定：保留待处理，等待对账任务查询确认
    if (result.status === 'PROCESSING') {
      await this.prisma.refund.update({
        where: { id: pending.id },
        data: {
          ...(result.transactionId ? { transactionId: result.transactionId } : {}),
          rawResponse: result.raw as never,
          channelStatus: 'PROCESSING',
          lastQueriedAt: new Date(),
        },
      });
      return { refundNo: pending.refundNo, status: 'PROCESSING' };
    }

    if (result.status === 'FAILED') {
      await this.prisma.refund.update({
        where: { id: pending.id },
        data: {
          status: 'FAILED',
          failReason: result.failReason ?? '渠道退款失败',
          channelStatus: 'CLOSED',
        },
      });
      await this.notifyRefundResult(pending.id);
      throw new ConflictException(result.failReason ?? '渠道退款失败');
    }

    return this.completeRefund(pending.id, {
      transactionId: result.transactionId,
      raw: result.raw,
      channelStatus: 'SUCCESS',
    });
  }

  /**
   * 渠道确认退款成功：幂等回写退款单、售后单、订单金额、状态与库存。
   * 支付同步响应与退款对账任务共用，重复调用只生效一次。
   */
  async completeRefund(
    refundId: string,
    channel: { transactionId?: string; raw?: unknown; channelStatus?: string } = {},
  ): Promise<{ refundNo: string; status: 'SUCCESS' }> {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { afterSale: { include: { order: true, orderItem: true } } },
    });
    if (!refund) throw new NotFoundException('退款单不存在');
    if (refund.status === 'SUCCESS') return { refundNo: refund.refundNo, status: 'SUCCESS' };

    const record = refund.afterSale;

    const applied = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.refund.updateMany({
        where: { id: refund.id, status: 'PENDING' },
        data: {
          status: 'SUCCESS',
          ...(channel.transactionId ? { transactionId: channel.transactionId } : {}),
          ...(channel.raw !== undefined ? { rawResponse: channel.raw as never } : {}),
          ...(channel.channelStatus ? { channelStatus: channel.channelStatus } : {}),
          refundedAt: new Date(),
        },
      });
      if (updated.count !== 1) return false; // 并发重复执行，已处理

      await tx.afterSale.update({
        where: { id: record.id },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
        },
      });

      await tx.orderItem.update({
        where: { id: record.orderItemId },
        data: { refundedCents: { increment: refund.amountCents } },
      });

      const order = await tx.order.update({
        where: { id: record.orderId },
        data: { refundedCents: { increment: refund.amountCents } },
      });

      // 未发货仅退款：库存可二次销售，回滚库存
      const beforeShipment =
        isBeforeShipment(record.order.status as OrderStatus) ||
        (record.order.previousStatus
          ? isBeforeShipment(record.order.previousStatus as OrderStatus)
          : false);
      if (beforeShipment) {
        if (record.order.storeId) {
          await this.storeInventory.restock(
            tx,
            record.order.storeId,
            [{ skuId: record.orderItem.skuId, quantity: record.orderItem.quantity }],
            record.orderId,
          );
        } else {
          await tx.sku.update({
            where: { id: record.orderItem.skuId },
            data: { stock: { increment: record.orderItem.quantity } },
          });
        }
      }

      const fullyRefunded = order.refundedCents >= order.payableCents;
      const previous = (record.previousOrderStatus ?? record.order.previousStatus ?? 'PAID') as OrderStatus;
      const next = fullyRefunded
        ? nextStatus('REFUNDING', 'refund_success')
        : nextStatus('REFUNDING', 'refund_partial_success', { previousStatus: previous });

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: next,
          version: { increment: 1 },
          previousStatus: fullyRefunded ? null : previous,
          ...(fullyRefunded && record.order.fulfillmentType === 'PICKUP'
            ? { pickupCode: null, pickupCodeExpiresAt: null }
            : {}),
        },
      });

      // 退款成功：累计消费与积分按退款额扣回（余额不为负），等级随之下调
      await this.loyalty.revokeForRefund(tx, {
        userId: record.order.userId,
        orderId: record.orderId,
        refundCents: refund.amountCents,
      });

      // 整单退款：已使用的券在有效期内退回，可再次使用
      if (fullyRefunded) await this.coupons.releaseForOrder(tx, record.orderId);

      // 余额支付的订单：退款原路退回储值余额并记流水
      if (refund.provider === 'balance') {
        const account = await tx.storedValueAccount.upsert({
          where: { userId: record.order.userId },
          update: { balanceCents: { increment: refund.amountCents } },
          create: { userId: record.order.userId, balanceCents: refund.amountCents },
        });
        await tx.storedValueLedger.create({
          data: {
            userId: record.order.userId,
            deltaCents: refund.amountCents,
            balanceAfter: account.balanceCents,
            type: 'REFUND',
            refType: 'Refund',
            refId: refund.id,
            remark: `订单退款 ${record.order.orderNo}`,
          },
        });
      }
      return true;
    });

    if (applied) await this.notifyRefundResult(refund.id);
    return { refundNo: refund.refundNo, status: 'SUCCESS' };
  }

  /** 退款结果通知：失败不影响退款主流程 */
  private async notifyRefundResult(refundId: string): Promise<void> {
    try {
      await this.notifications.enqueueRefundResult(refundId);
    } catch (err) {
      this.logger.warn(`退款结果通知入队失败 refund=${refundId}`, err as Error);
    }
  }

  /* ---------------- 内部 ---------------- */

  private assertTransition(from: AfterSaleStatus, action: AfterSaleAction): void {
    if (!canAfterSale(from, action)) {
      throw new ConflictException(`当前售后状态不支持该操作（${from} → ${action}）`);
    }
  }

  /** 拒绝或撤销后把订单恢复到申请前状态 */
  private async restoreOrder(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    record: { orderId: string; previousOrderStatus: OrderStatus | null },
  ): Promise<void> {
    const order = await tx.order.findUnique({ where: { id: record.orderId } });
    if (!order || order.status !== 'REFUNDING') return;

    const previous = (record.previousOrderStatus ?? 'PAID') as OrderStatus;
    await tx.order.updateMany({
      where: { id: order.id, status: 'REFUNDING', version: order.version },
      data: {
        status: nextStatus('REFUNDING', 'refund_reject', { previousStatus: previous }),
        version: { increment: 1 },
        previousStatus: null,
      },
    });
  }

  private view(a: {
    id: string;
    afterSaleNo: string;
    type: string;
    reason: string;
    description: string | null;
    evidenceJson: unknown;
    refundCents: number;
    status: string;
    rejectReason: string | null;
    buyerTrackingNo: string | null;
    createdAt: Date;
    finishedAt: Date | null;
    order?: { orderNo: string; payableCents: number } | null;
    orderItem?: { title: string; specText: string; priceCents: number; quantity: number } | null;
    refund?: {
      refundNo: string;
      status: string;
      channelStatus?: string | null;
      refundedAt: Date | null;
    } | null;
  }) {
    return {
      id: a.id,
      afterSaleNo: a.afterSaleNo,
      type: a.type,
      reason: a.reason,
      description: a.description,
      evidence: a.evidenceJson ?? [],
      refundCents: a.refundCents,
      status: a.status,
      rejectReason: a.rejectReason,
      buyerTrackingNo: a.buyerTrackingNo,
      createdAt: a.createdAt,
      finishedAt: a.finishedAt,
      orderNo: a.order?.orderNo,
      item: a.orderItem
        ? {
            title: a.orderItem.title,
            specText: a.orderItem.specText,
            priceCents: a.orderItem.priceCents,
            quantity: a.orderItem.quantity,
          }
        : null,
      refund: a.refund
        ? {
            refundNo: a.refund.refundNo,
            status: a.refund.status,
            channelStatus: a.refund.channelStatus ?? null,
            refundedAt: a.refund.refundedAt,
          }
        : null,
    };
  }
}
