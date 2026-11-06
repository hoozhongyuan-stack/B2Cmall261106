import {
  BadRequestException,
  ConflictException,
  Injectable,
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
import { CouponService } from '../coupon/coupon.service';
import { LoyaltyService } from '../member/loyalty.service';

const REFUNDABLE_ORDER_STATUS: OrderStatus[] = ['PAID', 'SHIPPED', 'COMPLETED'];

@Injectable()
export class AfterSaleService {
  private readonly refundProvider: RefundProvider = new MockRefundProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly coupons: CouponService,
    private readonly loyalty: LoyaltyService,
  ) {}

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

  async listAdmin(status?: string, page = 1, pageSize = 20) {
    const currentPage = Math.max(page, 1);
    const size = Math.min(Math.max(pageSize, 1), 100);
    const where = status ? { status: status as AfterSaleStatus } : {};

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
          provider: this.refundProvider.name,
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

    const result = await this.refundProvider.refund({
      refundNo: pending.refundNo,
      orderNo: record.order.orderNo,
      amountCents: pending.amountCents,
    });

    if (result.status === 'FAILED') {
      await this.prisma.refund.update({
        where: { id: pending.id },
        data: { status: 'FAILED', failReason: result.failReason ?? '渠道退款失败' },
      });
      throw new ConflictException(result.failReason ?? '渠道退款失败');
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.refund.updateMany({
        where: { id: pending.id, status: 'PENDING' },
        data: {
          status: 'SUCCESS',
          transactionId: result.transactionId,
          refundedAt: new Date(),
        },
      });
      if (updated.count !== 1) return; // 并发重复执行，已处理

      await tx.afterSale.update({
        where: { id: record.id },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
        },
      });

      await tx.orderItem.update({
        where: { id: record.orderItemId },
        data: { refundedCents: { increment: pending.amountCents } },
      });

      const order = await tx.order.update({
        where: { id: record.orderId },
        data: { refundedCents: { increment: pending.amountCents } },
      });

      // 未发货仅退款：库存可二次销售，回滚库存
      const beforeShipment =
        isBeforeShipment(record.order.status as OrderStatus) ||
        (record.order.previousStatus
          ? isBeforeShipment(record.order.previousStatus as OrderStatus)
          : false);
      if (beforeShipment) {
        await tx.sku.update({
          where: { id: record.orderItem.skuId },
          data: { stock: { increment: record.orderItem.quantity } },
        });
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
        },
      });

      // 退款成功：累计消费与积分按退款额扣回（余额不为负），等级随之下调
      await this.loyalty.revokeForRefund(tx, {
        userId: record.order.userId,
        orderId: record.orderId,
        refundCents: pending.amountCents,
      });

      // 整单退款：已使用的券在有效期内退回，可再次使用
      if (fullyRefunded) await this.coupons.releaseForOrder(tx, record.orderId);
    });

    return { refundNo: pending.refundNo, status: 'SUCCESS' };
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
    refund?: { refundNo: string; status: string; refundedAt: Date | null } | null;
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
        ? { refundNo: a.refund.refundNo, status: a.refund.status, refundedAt: a.refund.refundedAt }
        : null,
    };
  }
}
