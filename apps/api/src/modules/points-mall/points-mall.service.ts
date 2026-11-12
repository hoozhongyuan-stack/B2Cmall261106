import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { can, isBeforeShipment } from '@shanye/shared';

import { PrismaService, isUniqueViolation } from '../../prisma/prisma.module';
import { lockSkuForUpdate } from '../../prisma/queries';
import { generateOrderNo } from '../../common/password';
import { IntegrationService } from '../integration/integration.service';
import { OrderService } from '../order/order.service';
import { BalanceRefundProvider } from '../payment/balance-refund.provider';
import { MockRefundProvider, type RefundProvider } from '../payment/refund.provider';
import { WechatRefundProvider } from '../payment/wechat/wechat-refund.provider';
import { revertPointsExchange } from './points-order.util';

export interface ExchangeInput {
  skuId: string;
  quantity: number;
  addressId?: string;
  fulfillmentType?: string;
  contactPhone?: string;
  remark?: string;
}

@Injectable()
export class PointsMallService {
  private readonly logger = new Logger(PointsMallService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integration: IntegrationService,
    private readonly orders: OrderService,
  ) {}

  /** 小程序：积分商品瀑布流列表（仅上架且有库存） */
  async listProducts(query: { page?: number; pageSize?: number }) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 50);

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where: { channel: 'POINTS', status: 'ON_SALE' },
        orderBy: [{ sort: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          skus: {
            select: {
              id: true,
              pointsCost: true,
              pointsMoneyCents: true,
              stock: true,
              reserved: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.product.count({ where: { channel: 'POINTS', status: 'ON_SALE' } }),
    ]);

    const items = products
      .map((product) => {
        const redeemable = product.skus.filter(
          (sku) =>
            sku.status === 'ON_SALE' &&
            sku.pointsCost !== null &&
            sku.pointsCost > 0 &&
            Math.max(sku.stock - sku.reserved, 0) > 0,
        );
        if (redeemable.length === 0) return null;
        const points = redeemable.map((sku) => sku.pointsCost!);
        const pointsMin = Math.min(...points);
        const cheapest = redeemable.filter((sku) => sku.pointsCost === pointsMin);
        return {
          id: product.id,
          title: product.title,
          subtitle: product.subtitle,
          mainImageKey: product.mainImageKey,
          pointsCostMin: pointsMin,
          pointsMoneyCentsMin: Math.min(...cheapest.map((sku) => sku.pointsMoneyCents)),
          stock: redeemable.reduce(
            (sum, sku) => sum + Math.max(sku.stock - sku.reserved, 0),
            0,
          ),
          pointsLimitPerUser: product.pointsLimitPerUser,
          soldCount: product.soldCount,
          skuCount: redeemable.length,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return { total, page, pageSize, items };
  }

  /** 当前用户在某积分商品的已兑 / 剩余可兑 */
  async limits(userId: string, productId: string) {
    const [product, quota, user] = await Promise.all([
      this.prisma.product.findFirst({
        where: { id: productId, channel: 'POINTS' },
        select: { pointsLimitPerUser: true },
      }),
      this.prisma.pointsMallQuota.findUnique({
        where: { userId_productId: { userId, productId } },
        select: { usedQty: true },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
    ]);
    if (!product) throw new NotFoundException('积分商品不存在');

    const limit = product.pointsLimitPerUser;
    const used = quota?.usedQty ?? 0;
    return {
      limit,
      used,
      remaining: limit > 0 ? Math.max(limit - used, 0) : null,
      balance: user?.points ?? 0,
    };
  }

  /** 兑换下单：扣积分 / 预占库存 / 记录限兑；纯积分直接完成支付 */
  async exchange(userId: string, input: ExchangeInput, idempotencyKey: string) {
    if (!idempotencyKey) throw new BadRequestException('缺少 Idempotency-Key');
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException('兑换数量必须为正整数');
    }
    if (input.fulfillmentType && input.fulfillmentType !== 'EXPRESS') {
      throw new BadRequestException('积分兑换暂仅支持快递配送');
    }

    const duplicated = await this.prisma.order.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
    if (duplicated) return this.exchangeView(duplicated.id);

    const address = input.addressId
      ? await this.prisma.address.findFirst({ where: { id: input.addressId, userId } })
      : null;
    if (!address) throw new NotFoundException('请选择收货地址');

    const config = await this.prisma.shopConfig.findFirst();
    const payDeadlineAt = new Date(
      Date.now() + (config?.payTimeoutMinutes ?? 15) * 60_000,
    );

    try {
      const orderId = await this.prisma.$transaction(async (tx) => {
        const sku = await lockSkuForUpdate(tx, input.skuId);
        if (!sku) throw new NotFoundException('商品不存在');
        if (sku.channel !== 'POINTS') throw new BadRequestException('该商品不支持积分兑换');
        if (sku.status !== 'ON_SALE') throw new ConflictException('商品已下架');
        if (sku.pointsCost === null || sku.pointsCost <= 0) {
          throw new BadRequestException('该规格暂不支持积分兑换');
        }

        const product = await tx.product.findUnique({ where: { id: sku.productId } });
        if (!product || product.channel !== 'POINTS' || product.status !== 'ON_SALE') {
          throw new ConflictException('商品已下架');
        }

        const available = Math.max(sku.stock - sku.reserved, 0);
        if (available < input.quantity) {
          throw new ConflictException(`库存不足，仅剩 ${available} 件`);
        }

        // 每人限兑：原子累加后校验，超限抛错回滚
        if (product.pointsLimitPerUser > 0) {
          const quota = await tx.pointsMallQuota.upsert({
            where: { userId_productId: { userId, productId: product.id } },
            create: { userId, productId: product.id, usedQty: input.quantity },
            update: { usedQty: { increment: input.quantity } },
          });
          if (quota.usedQty > product.pointsLimitPerUser) {
            throw new ConflictException(
              `每人限兑 ${product.pointsLimitPerUser} 件，已兑 ${quota.usedQty - input.quantity} 件`,
            );
          }
        }

        const pointsCost = sku.pointsCost;
        const pointsTotal = pointsCost * input.quantity;
        const moneyUnit = sku.pointsMoneyCents;
        const moneyTotal = moneyUnit * input.quantity;

        const balanceUpdated = await tx.user.updateMany({
          where: { id: userId, points: { gte: pointsTotal } },
          data: { points: { decrement: pointsTotal } },
        });
        if (balanceUpdated.count !== 1) {
          throw new BadRequestException('积分不足');
        }
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { points: true },
        });

        await tx.sku.update({
          where: { id: sku.id },
          data: { reserved: { increment: input.quantity } },
        });

        const order = await tx.order.create({
          data: {
            orderNo: generateOrderNo(),
            userId,
            idempotencyKey,
            status: 'PENDING_PAYMENT',
            orderType: 'POINTS',
            pointsUsed: pointsTotal,
            fulfillmentType: 'EXPRESS',
            goodsCents: moneyTotal,
            payableCents: moneyTotal,
            addressSnapshot: {
              receiver: address.receiver,
              phone: address.phone,
              region: address.region,
              detail: address.detail,
            },
            remark: input.remark,
            payDeadlineAt,
            items: {
              create: [
                {
                  skuId: sku.id,
                  title: sku.title,
                  specText: Object.values(
                    (sku.specJson ?? {}) as Record<string, string>,
                  ).join(' / '),
                  imageKey: sku.imageKey,
                  priceCents: moneyUnit,
                  quantity: input.quantity,
                  subtotalCents: moneyTotal,
                  paidCents: moneyTotal,
                  pointsCost,
                },
              ],
            },
          },
        });

        await tx.pointsLedger.create({
          data: {
            userId,
            delta: -pointsTotal,
            source: 'EXCHANGE',
            reason: `积分兑换：${sku.title}`,
            orderId: order.id,
            balanceAfter: user.points,
          },
        });

        return order.id;
      });

      const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.payableCents === 0) {
        // 纯积分：生成 0 元支付单并直接完成，复用支付成功后的库存结算
        await this.prisma.payment.create({
          data: {
            orderId: order.id,
            provider: 'points',
            outTradeNo: `${order.orderNo}P`,
            amountCents: 0,
            status: 'SUCCESS',
            paidAt: new Date(),
          },
        });
        await this.orders.markPaid(order.id, 0, `points:${order.orderNo}`);
      }

      return this.exchangeView(order.id);
    } catch (err) {
      if (isUniqueViolation(err)) {
        const existing = await this.prisma.order.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey } },
        });
        if (existing) return this.exchangeView(existing.id);
      }
      throw err;
    }
  }

  /** 后台：积分兑换单整单退款（返还积分、回补库存、回退限兑） */
  async refundOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, payments: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.orderType !== 'POINTS') throw new BadRequestException('仅积分兑换单支持该操作');
    if (!['PAID', 'SHIPPED', 'COMPLETED'].includes(order.status)) {
      throw new ConflictException('当前订单状态不可退款');
    }
    if (order.refundedCents >= order.payableCents && order.payableCents > 0) {
      throw new ConflictException('订单已退款');
    }

    let providerName = 'points';
    let refundTransactionId: string | null = null;
    const amountCents = order.payableCents;

    if (amountCents > 0) {
      const payment = order.payments.find((item) => item.status === 'SUCCESS');
      const provider = await this.refundProviderFor(payment?.provider);
      providerName = provider.name;
      const refundNo = `RF${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
      const afterSale =
        (await this.prisma.afterSale.findUnique({
          where: { orderItemId: order.items[0].id },
        })) ??
        (await this.prisma.afterSale.create({
          data: {
            afterSaleNo: `AS${Date.now()}${Math.floor(Math.random() * 900 + 100)}`,
            orderId: order.id,
            orderItemId: order.items[0].id,
            userId: order.userId,
            type: 'REFUND_ONLY',
            reason: '积分兑换整单退款',
            refundCents: amountCents,
            previousOrderStatus: order.status,
          },
        }));
      const refund =
        (await this.prisma.refund.findUnique({ where: { afterSaleId: afterSale.id } })) ??
        (await this.prisma.refund.create({
          data: {
            refundNo,
            afterSaleId: afterSale.id,
            orderId: order.id,
            amountCents,
            provider: provider.name,
          },
        }));
      const result = await provider.refund({
        refundNo: refund.refundNo,
        orderNo: order.orderNo,
        amountCents,
        totalCents: order.payableCents,
        transactionId: payment?.transactionId ?? undefined,
        reason: '积分兑换整单退款',
      });
      if (result.status === 'FAILED') {
        await this.prisma.refund.update({
          where: { id: refund.id },
          data: { status: 'FAILED', failReason: result.failReason ?? '渠道退款失败' },
        });
        throw new ConflictException(result.failReason ?? '渠道退款失败');
      }
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: result.status === 'SUCCESS' ? 'SUCCESS' : 'PENDING',
          transactionId: result.transactionId || null,
          channelStatus: result.status,
          refundedAt: result.status === 'SUCCESS' ? new Date() : null,
        },
      });
      refundTransactionId = result.transactionId || null;

      if (result.status !== 'SUCCESS') {
        this.logger.warn(`积分兑换退款已受理待确认 order=${order.id} refund=${refund.refundNo}`);
        throw new ConflictException('退款已提交渠道处理，请稍后在退款单中查询结果');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'REFUNDED',
          refundedCents: amountCents,
          version: { increment: 1 },
          closedAt: new Date(),
        },
      });
      await tx.orderItem.updateMany({
        where: { orderId: order.id },
        data: { refundedCents: 0 },
      });
      for (const item of order.items) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { refundedCents: item.paidCents },
        });
      }

      // 未发货才回补库存；已发货商品不参与二次销售
      if (isBeforeShipment(order.status as never)) {
        for (const item of order.items) {
          await tx.sku.update({
            where: { id: item.skuId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }

      await revertPointsExchange(tx, {
        id: order.id,
        userId: order.userId,
        orderType: order.orderType,
        pointsUsed: order.pointsUsed,
        items: order.items,
      });
    });

    return {
      orderId: order.id,
      refundedCents: amountCents,
      pointsRefunded: order.pointsUsed,
      provider: providerName,
      transactionId: refundTransactionId,
    };
  }

  private exchangeView(orderId: string) {
    return this.prisma.order
      .findUniqueOrThrow({ where: { id: orderId }, include: { items: true } })
      .then((order) => ({
        orderId: order.id,
        orderNo: order.orderNo,
        status: order.status,
        payableCents: order.payableCents,
        pointsUsed: order.pointsUsed,
        needsPay: order.payableCents > 0 && can(order.status as never, 'pay_success'),
        items: order.items.map((item) => ({
          title: item.title,
          specText: item.specText,
          imageKey: item.imageKey,
          quantity: item.quantity,
          priceCents: item.priceCents,
          pointsCost: item.pointsCost,
        })),
      }));
  }

  private async refundProviderFor(paymentProvider?: string): Promise<RefundProvider> {
    if (paymentProvider === 'wechat') {
      return new WechatRefundProvider(await this.integration.wechatPayConfig());
    }
    if (paymentProvider === 'balance') return new BalanceRefundProvider();
    return new MockRefundProvider();
  }
}
