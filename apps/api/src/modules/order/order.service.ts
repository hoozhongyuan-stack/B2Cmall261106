import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  allocateLinePaidCents,
  calculateDeliveryFee,
  calculateOrderAmount,
  can,
  checkDeliverySlot,
  matchDeliveryRegion,
  nextStatus,
  type OrderAmount,
} from '@shanye/shared';

import { PrismaService, isUniqueViolation, type TxClient } from '../../prisma/prisma.module';
import { lockSkuForUpdate, type LockedSkuRow } from '../../prisma/queries';
import { generateOrderNo } from '../../common/password';
import { CouponService } from '../coupon/coupon.service';
import { LoyaltyService } from '../member/loyalty.service';
import {
  PromotionService,
  type FullReductionMatch,
  type SeckillMatch,
} from '../promotion/promotion.service';
import {
  StoreInventoryService,
  type FulfillmentStore,
  type FulfillmentType,
} from '../store/store-inventory.service';

export interface OrderLineInput {
  skuId: string;
  quantity: number;
}

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coupons: CouponService,
    private readonly loyalty: LoyaltyService,
    private readonly promotions: PromotionService,
    private readonly storeInventory: StoreInventoryService,
  ) {}

  /** 结算预览：不锁库存，只算钱与可用券 */
  async preview(
    userId: string,
    input: {
      items?: OrderLineInput[];
      couponClaimId?: string;
      region?: string;
      fulfillmentType?: string;
      storeId?: string;
      pickupSlot?: string;
      deliverySlot?: string;
    },
  ) {
    const fulfillment = await this.storeInventory.resolveFulfillment(input);
    const pickup =
      fulfillment.type === 'PICKUP' && fulfillment.store
        ? this.pickupInfo(fulfillment.store, input.pickupSlot, false)
        : null;
    const delivery =
      fulfillment.type === 'DELIVERY' && fulfillment.store
        ? await this.deliveryInfo(fulfillment.store, input.region, input.deliverySlot, false)
        : null;
    const lines = await this.resolveLines(userId, input.items, fulfillment);
    const config = await this.loadConfig();
    const { rate, levelName, cardName, freeShipping } = await this.memberRate(userId);

    const afterMemberNormalCents = Math.round(lines.normalGoodsCents * rate);
    const coupon = input.couponClaimId
      ? await this.loadCoupon(userId, input.couponClaimId, afterMemberNormalCents)
      : null;
    const couponCents = coupon
      ? Math.min(
          coupon.rule.faceValueCents,
          afterMemberNormalCents >= coupon.rule.thresholdCents ? afterMemberNormalCents : 0,
        )
      : 0;

    const candidates = await this.promotions.fullReductionCandidates(lines.lines);
    const fullReduction = this.pickFullReduction(candidates, afterMemberNormalCents - couponCents);

    const exceptions = await this.prisma.shippingRegionException.findMany();
    const freight =
      pickup || delivery
        ? { freeThresholdCents: 0, flatCents: 0, isExceptionRegion: false }
        : this.buildFreight(config, input.region, exceptions, freeShipping);
    const baseAmount = calculateOrderAmount({
      items: lines.items,
      memberDiscountRate: rate,
      coupon: coupon?.rule ?? null,
      fullReduction: fullReduction
        ? { thresholdCents: fullReduction.thresholdCents, discountCents: fullReduction.discountCents }
        : null,
      freight,
    });
    // 同城配送费按「会员折扣后商品金额」判断满额免配送，单独于通用运费计算
    const deliveryFeeCents = delivery ? this.deliveryFeeFor(delivery.store, baseAmount) : 0;
    const amount: OrderAmount = deliveryFeeCents
      ? {
          ...baseAmount,
          freightCents: deliveryFeeCents,
          payableCents: baseAmount.payableCents + deliveryFeeCents,
        }
      : baseAmount;

    // 券门槛按「普通商品金额 - 会员折扣」判断，与下单时口径保持一致
    const availableCoupons = await this.listUsableCoupons(userId, afterMemberNormalCents);

    return {
      items: lines.view,
      amount,
      member: { levelName, rate, cardName, freeShipping },
      coupon: coupon ? { claimId: coupon.claimId, name: coupon.name } : null,
      fullReduction: fullReduction
        ? {
            id: fullReduction.id,
            name: fullReduction.name,
            thresholdCents: fullReduction.thresholdCents,
            discountCents: fullReduction.discountCents,
          }
        : null,
      availableCoupons,
      fulfillmentType: fulfillment.type,
      pickup,
      delivery: delivery
        ? {
            slot: delivery.slot,
            region: delivery.region,
            feeCents: deliveryFeeCents,
            store: this.deliveryStoreView(delivery.store),
          }
        : null,
      freight: {
        freeThresholdCents: config.freeThresholdCents,
        // 命中地区例外时返回例外运费，而不是通用固定运费
        flatCents: freight.flatCents,
        exceptionRegion: freight.isExceptionRegion ?? false,
      },
    };
  }

  /** 创建订单：幂等键 + 行锁预占库存 + 金额快照 */
  async create(
    userId: string,
    dto: {
      items?: OrderLineInput[];
      addressId?: string;
      couponClaimId?: string;
      remark?: string;
      fulfillmentType?: string;
      storeId?: string;
      pickupSlot?: string;
      deliverySlot?: string;
      contactPhone?: string;
    },
    idempotencyKey: string,
  ) {
    if (!idempotencyKey) throw new BadRequestException('缺少 Idempotency-Key');

    const duplicated = await this.prisma.order.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
    if (duplicated) return this.view(duplicated.id);

    // 未指定商品时，取购物车勾选项（与结算预览口径一致）
    const source: OrderLineInput[] =
      dto.items?.length
        ? dto.items
        : (
            await this.prisma.cartItem.findMany({ where: { userId, checked: true } })
          ).map((i) => ({ skuId: i.skuId, quantity: i.quantity }));
    if (!source.length) throw new BadRequestException('没有可结算的商品');

    const fulfillment = await this.storeInventory.resolveFulfillment(dto);
    const address = dto.addressId
      ? await this.prisma.address.findFirst({ where: { id: dto.addressId, userId } })
      : null;
    if (fulfillment.type !== 'PICKUP' && !address) {
      throw new NotFoundException('收货地址不存在');
    }
    const pickup =
      fulfillment.type === 'PICKUP' && fulfillment.store
        ? this.pickupInfo(fulfillment.store, dto.pickupSlot, false)
        : null;
    const delivery =
      fulfillment.type === 'DELIVERY' && fulfillment.store
        ? await this.deliveryInfo(fulfillment.store, address?.region, dto.deliverySlot, true)
        : null;
    const config = await this.loadConfig();
    const { rate, freeShipping } = await this.memberRate(userId);
    const exceptions = await this.prisma.shippingRegionException.findMany();

    try {
      const orderId = await this.prisma.$transaction(async (tx) => {
        const ids = [...new Set(source.map((i) => i.skuId))].sort();
        const locked: LockedSkuRow[] = [];
        if (fulfillment.storeId) {
          // 门店库存由 StoreSku 条件更新保证不超卖，无需锁总部仓 SKU 行
          const rows = await tx.sku.findMany({
            where: { id: { in: ids } },
            include: { product: true },
          });
          if (rows.length !== ids.length) throw new NotFoundException('商品不存在');
          for (const row of rows) {
            locked.push({
              id: row.id,
              stock: row.stock,
              reserved: row.reserved,
              priceCents: row.priceCents,
              status: row.status,
              code: row.code,
              specJson: row.specJson,
              productId: row.productId,
              categoryId: row.product.categoryId,
              title: row.product.title,
              imageKey: row.product.mainImageKey,
            });
          }
        } else {
          // 行锁：同一 SKU 的并发下单在此串行化，避免总部仓超卖
          for (const id of ids) {
            const row = await lockSkuForUpdate(tx, id);
            if (!row) throw new NotFoundException('商品不存在');
            locked.push(row);
          }
        }

        const byId = new Map(locked.map((s) => [s.id, s]));
        const seckills = await this.promotions.seckillForSkus(ids, tx);
        const storeAvailable = fulfillment.storeId
          ? await this.storeInventory.availableMap(fulfillment.storeId, ids)
          : null;

        const itemsForAmount: Array<{
          sku: LockedSkuRow;
          quantity: number;
          seckill: SeckillMatch | null;
          priceCents: number;
        }> = [];
        for (const line of source) {
          const sku = byId.get(line.skuId)!;
          if (sku.status !== 'ON_SALE') throw new ConflictException('商品已下架');
          const available = storeAvailable
            ? (storeAvailable.get(sku.id) ?? 0)
            : Math.max(sku.stock - sku.reserved, 0);
          if (available < line.quantity) {
            throw new ConflictException(
              storeAvailable
                ? `门店库存不足，${sku.title} 仅剩 ${available} 件`
                : `库存不足，${sku.title} 仅剩 ${available} 件`,
            );
          }

          const seckill = seckills.get(sku.id) ?? null;
          if (seckill) {
            if (seckill.sold + line.quantity > seckill.stock) {
              throw new ConflictException(`秒杀库存不足，${sku.title} 仅剩 ${seckill.stock - seckill.sold} 件`);
            }
            if (seckill.limitPerUser > 0) {
              const prior = await tx.orderItem.aggregate({
                _sum: { quantity: true },
                where: {
                  seckillId: seckill.id,
                  order: { userId, status: { notIn: ['CLOSED', 'REFUNDED'] } },
                },
              });
              if ((prior._sum.quantity ?? 0) + line.quantity > seckill.limitPerUser) {
                throw new ConflictException(`该秒杀商品每人限购 ${seckill.limitPerUser} 件`);
              }
            }
            const reservedSeckill = await tx.seckillSku.updateMany({
              where: { id: seckill.id, sold: { lte: seckill.stock - line.quantity } },
              data: { sold: { increment: line.quantity } },
            });
            if (reservedSeckill.count !== 1) {
              throw new ConflictException(`秒杀库存不足，${sku.title} 已被抢完`);
            }
          }

          itemsForAmount.push({
            sku,
            quantity: line.quantity,
            seckill,
            priceCents: seckill ? Math.min(seckill.priceCents, sku.priceCents) : sku.priceCents,
          });
        }

        const normalGoodsCents = itemsForAmount
          .filter((item) => !item.seckill)
          .reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
        const afterMemberNormalCents = Math.round(normalGoodsCents * rate);
        const coupon = dto.couponClaimId
          ? await this.loadCoupon(userId, dto.couponClaimId, afterMemberNormalCents)
          : null;
        const couponCents = coupon
          ? Math.min(
              coupon.rule.faceValueCents,
              afterMemberNormalCents >= coupon.rule.thresholdCents ? afterMemberNormalCents : 0,
            )
          : 0;

        const candidates = await this.promotions.fullReductionCandidates(
          itemsForAmount.map((item) => ({
            productId: item.sku.productId,
            categoryId: item.sku.categoryId,
            seckill: Boolean(item.seckill),
          })),
        );
        const fullReduction = this.pickFullReduction(
          candidates,
          afterMemberNormalCents - couponCents,
        );

        const baseAmount = calculateOrderAmount({
          items: itemsForAmount.map((item) => ({
            priceCents: item.priceCents,
            quantity: item.quantity,
            seckill: Boolean(item.seckill),
          })),
          memberDiscountRate: rate,
          coupon: coupon?.rule ?? null,
          fullReduction: fullReduction
            ? {
                thresholdCents: fullReduction.thresholdCents,
                discountCents: fullReduction.discountCents,
              }
            : null,
          freight:
            pickup || delivery
              ? { freeThresholdCents: 0, flatCents: 0, isExceptionRegion: false }
              : this.buildFreight(config, address!.region, exceptions, freeShipping),
        });
        // 同城配送费按「会员折扣后商品金额」判断满额免配送
        const deliveryFeeCents = delivery
          ? this.deliveryFeeFor(delivery.store, baseAmount)
          : 0;
        const amount: OrderAmount = deliveryFeeCents
          ? {
              ...baseAmount,
              freightCents: deliveryFeeCents,
              payableCents: baseAmount.payableCents + deliveryFeeCents,
            }
          : baseAmount;

        if (!fulfillment.storeId) {
          for (const item of itemsForAmount) {
            await tx.sku.update({
              where: { id: item.sku.id },
              data: { reserved: { increment: item.quantity } },
            });
          }
        }

        // 行实付分摊：会员折扣、券与满减只摊到普通商品行，作为退款上限依据
        const linePaid = allocateLinePaidCents({
          lines: itemsForAmount.map((item) => ({
            priceCents: item.priceCents,
            quantity: item.quantity,
            seckill: Boolean(item.seckill),
          })),
          memberDiscountCents: amount.memberDiscountCents,
          couponCents: amount.couponCents,
          fullReductionCents: amount.fullReductionCents,
        });

        const order = await tx.order.create({
          data: {
            orderNo: generateOrderNo(),
            userId,
            idempotencyKey,
            status: 'PENDING_PAYMENT',
            fulfillmentType: fulfillment.type,
            storeId: fulfillment.storeId,
            goodsCents: amount.goodsCents,
            memberDiscountCents: amount.memberDiscountCents,
            couponCents: amount.couponCents,
            fullReductionCents: amount.fullReductionCents,
            freightCents: amount.freightCents,
            payableCents: amount.payableCents,
            pickupAt: pickup?.pickupAt ?? null,
            deliverySlot: delivery?.slot ?? null,
            addressSnapshot: pickup
              ? {
                  type: 'PICKUP',
                  storeId: pickup.store.id,
                  storeName: pickup.store.name,
                  storePhone: pickup.store.phone,
                  storeAddress: pickup.store.address,
                  pickupSlot: pickup.slot,
                  phone: dto.contactPhone?.trim() || address?.phone || '',
                }
              : {
                  receiver: address!.receiver,
                  phone: address!.phone,
                  region: address!.region,
                  detail: address!.detail,
                },
            remark: dto.remark,
            payDeadlineAt: new Date(Date.now() + config.payTimeoutMinutes * 60_000),
            items: {
              create: itemsForAmount.map((item, idx) => ({
                skuId: item.sku.id,
                title: item.sku.title,
                specText: Object.values(item.sku.specJson as Record<string, string>).join(' / '),
                imageKey: item.sku.imageKey,
                priceCents: item.priceCents,
                quantity: item.quantity,
                subtotalCents: item.priceCents * item.quantity,
                paidCents: linePaid[idx],
                isSeckill: Boolean(item.seckill),
                seckillId: item.seckill?.id ?? null,
              })),
            },
          },
        });

        if (coupon) {
          const updated = await tx.couponClaim.updateMany({
            where: { id: coupon.claimId, userId, status: 'UNUSED' },
            data: { status: 'USED', orderId: order.id, usedAt: new Date() },
          });
          if (updated.count !== 1) throw new ConflictException('优惠券已被使用');
        }

        // 门店库存预占放到事务末尾：缩短行锁持有时间，50 并发下避免事务超时
        if (fulfillment.storeId) {
          await this.storeInventory.reserve(
            tx,
            fulfillment.storeId,
            itemsForAmount.map((item) => ({
              skuId: item.sku.id,
              quantity: item.quantity,
            })),
          );
        }

        return order.id;
      }, { maxWait: 15_000, timeout: 20_000 });

      return this.view(orderId);
    } catch (err) {
      // 并发下同一幂等键可能同时穿过预检，唯一约束兜底
      if (isUniqueViolation(err)) {
        const existing = await this.prisma.order.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey } },
        });
        if (existing) return this.view(existing.id);
      }
      throw err;
    }
  }

  async list(userId: string, status?: string) {
    const orders = await this.prisma.order.findMany({
      where: { userId, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
      take: 50,
    });
    return { items: orders.map((o) => this.toListItem(o)) };
  }

  async view(orderId: string, userId?: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, ...(userId ? { userId } : {}) },
      include: {
        items: true,
        shipment: true,
        payments: true,
        pickupVerification: true,
        delivery: true,
        store: {
          select: {
            id: true,
            name: true,
            phone: true,
            region: true,
            address: true,
            businessHours: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');

    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      fulfillmentType: order.fulfillmentType,
      storeId: order.storeId,
      storeName: order.store?.name ?? null,
      store: order.store,
      pickupCode: order.pickupCode,
      pickupAt: order.pickupAt,
      pickupCodeExpiresAt: order.pickupCodeExpiresAt,
      deliverySlot: order.deliverySlot,
      pickupVerifiedAt: order.pickupVerification?.verifiedAt ?? null,
      pickupVerification: order.pickupVerification
        ? {
            method: order.pickupVerification.method,
            verifiedBy: order.pickupVerification.verifiedBy,
            verifiedAt: order.pickupVerification.verifiedAt,
            note: order.pickupVerification.note,
          }
        : null,
      payDeadlineAt: order.payDeadlineAt,
      paidAt: order.paidAt,
      shippedAt: order.shippedAt,
      createdAt: order.createdAt,
      remark: order.remark,
      address: order.addressSnapshot,
      amount: {
        goodsCents: order.goodsCents,
        memberDiscountCents: order.memberDiscountCents,
        couponCents: order.couponCents,
        fullReductionCents: order.fullReductionCents,
        freightCents: order.freightCents,
        payableCents: order.payableCents,
        refundedCents: order.refundedCents,
      },
      items: order.items.map((i) => ({
        id: i.id,
        skuId: i.skuId,
        title: i.title,
        specText: i.specText,
        imageKey: i.imageKey,
        priceCents: i.priceCents,
        quantity: i.quantity,
        subtotalCents: i.subtotalCents,
        isSeckill: i.isSeckill,
      })),
      shipment: order.shipment
        ? {
            expressName: order.shipment.expressName,
            expressCode: order.shipment.expressCode,
            trackingNo: order.shipment.trackingNo,
            shippedAt: order.shipment.shippedAt,
          }
        : null,
      delivery: order.delivery
        ? {
            status: order.delivery.status,
            courierName: order.delivery.courierName,
            courierPhone: order.delivery.courierPhone,
            acceptedAt: order.delivery.acceptedAt,
            deliveredAt: order.delivery.deliveredAt,
            remark: order.delivery.remark,
          }
        : null,
      payments: order.payments.map((p) => ({
        provider: p.provider,
        status: p.status,
        outTradeNo: p.outTradeNo,
        paidAt: p.paidAt,
      })),
    };
  }

  /** 取消未支付订单：乐观锁 + 释放预占 */
  async cancel(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('订单不存在');

    // 状态机前置于事务：不可取消时直接 409，而不是抛未捕获错误变成 500
    if (!can(order.status as never, 'cancel')) {
      throw new ConflictException('订单状态已变化，请刷新');
    }
    const next = nextStatus(order.status as never, 'cancel');

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id: orderId, version: order.version, status: order.status },
        data: { status: next as never, version: { increment: 1 }, closedAt: new Date() },
      });
      if (updated.count !== 1) throw new ConflictException('订单状态已变化，请刷新');

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

      // 取消未支付订单：已锁定的券在有效期内退回
      await this.coupons.releaseForOrder(tx, orderId);
    });

    return this.view(orderId, userId);
  }

  /** 确认收货：待收货 → 已完成，之后才能评价 */
  async confirm(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) throw new NotFoundException('订单不存在');

    if (!can(order.status as never, 'confirm')) {
      throw new ConflictException('当前订单状态不可确认收货');
    }
    const next = nextStatus(order.status as never, 'confirm');

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id: orderId, version: order.version, status: order.status },
        data: { status: next as never, version: { increment: 1 }, completedAt: new Date() },
      });
      if (updated.count !== 1) throw new ConflictException('订单状态已变化，请刷新');
    });

    return this.view(orderId, userId);
  }

  /** 供支付模块调用：支付成功后的状态与库存结算 */
  async markPaid(orderId: string, paidAmountCents: number, transactionId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.payableCents !== paidAmountCents) {
      throw new ConflictException('支付金额与订单应付不一致');
    }

    if (!can(order.status as never, 'pay_success')) {
      throw new ConflictException('订单状态已变化，请刷新');
    }
    const next = nextStatus(order.status as never, 'pay_success');
    const pickupStore =
      order.fulfillmentType === 'PICKUP' && order.storeId
        ? await this.prisma.store.findUnique({ where: { id: order.storeId } })
        : null;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id: orderId, version: order.version, status: order.status },
        data: { status: next as never, version: { increment: 1 }, paidAt: new Date() },
      });
      if (updated.count !== 1) throw new ConflictException('订单状态已变化，请刷新');

      // 自提订单支付成功即出码，过期时间按门店自提完成天数计算
      if (order.fulfillmentType === 'PICKUP' && order.storeId) {
        const pickupCode = await this.generatePickupCode(tx);
        await tx.order.update({
          where: { id: orderId },
          data: {
            pickupCode,
            pickupCodeExpiresAt: new Date(
              Date.now() + (pickupStore?.pickupCompleteDays ?? 7) * 86_400_000,
            ),
          },
        });
      }

      // 同城配送：支付成功创建待接单配送单，幂等键为 orderId
      if (order.fulfillmentType === 'DELIVERY' && order.storeId) {
        await tx.delivery.upsert({
          where: { orderId },
          create: { orderId, storeId: order.storeId, status: 'PENDING' },
          update: {},
        });
      }

      if (order.storeId) {
        await this.storeInventory.commit(
          tx,
          order.storeId,
          order.items.map((item) => ({ skuId: item.skuId, quantity: item.quantity })),
          order.id,
        );
      }

      for (const item of order.items) {
        // 支付成功：预占转为真实扣减
        if (!order.storeId) {
          await tx.sku.update({
            where: { id: item.skuId },
            data: { stock: { decrement: item.quantity }, reserved: { decrement: item.quantity } },
          });
        }
        await tx.product.update({
          where: { id: (await tx.sku.findUnique({ where: { id: item.skuId } }))!.productId },
          data: { soldCount: { increment: item.quantity } },
        });
      }

      await tx.payment.updateMany({
        where: { orderId, status: 'PENDING' },
        data: { status: 'SUCCESS', transactionId, paidAt: new Date() },
      });

      // 支付成功：累计消费与积分入账，并按累计消费重算会员等级
      await this.loyalty.grantForOrder(tx, {
        userId: order.userId,
        orderId,
        payableCents: order.payableCents,
      });
    });

    return this.view(orderId);
  }

  /* ---------------- 内部 ---------------- */

  private toListItem(order: {
    id: string;
    orderNo: string;
    status: string;
    payableCents: number;
    createdAt: Date;
    payDeadlineAt: Date;
    items: { title: string; specText: string; imageKey: string | null; quantity: number; priceCents: number }[];
  }) {
    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      payableCents: order.payableCents,
      createdAt: order.createdAt,
      payDeadlineAt: order.payDeadlineAt,
      itemCount: order.items.reduce((s, i) => s + i.quantity, 0),
      items: order.items.slice(0, 3).map((i) => ({
        title: i.title,
        specText: i.specText,
        imageKey: i.imageKey,
        quantity: i.quantity,
        priceCents: i.priceCents,
      })),
    };
  }

  private async loadConfig() {
    const config = await this.prisma.shopConfig.findFirst();
    return {
      freeThresholdCents: config?.freeThresholdCents ?? 9900,
      flatFreightCents: config?.flatFreightCents ?? 1000,
      payTimeoutMinutes: config?.payTimeoutMinutes ?? 15,
    };
  }

  /** 满减取最优：达门槛的活动里取优惠金额最大者，同额取先结束者 */
  private pickFullReduction(
    candidates: FullReductionMatch[],
    normalAfterCouponCents: number,
  ): FullReductionMatch | null {
    const eligible = candidates
      .filter((item) => normalAfterCouponCents >= item.thresholdCents)
      .sort(
        (a, b) => b.discountCents - a.discountCents || a.endAt.getTime() - b.endAt.getTime(),
      );
    return eligible[0] ?? null;
  }

  /**
   * 会员折扣取最优：等级折扣与付费会员卡折扣不叠加，取更低的一档；
   * 会员卡额外提供积分倍率与包邮权益。
   */
  private async memberRate(userId: string) {
    const [user, card] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, include: { level: true } }),
      this.prisma.memberCard.findFirst({
        where: { userId, status: 'ACTIVE', expireAt: { gt: new Date() } },
        orderBy: { expireAt: 'desc' },
      }),
    ]);
    const levelRate = user?.level?.discountRate ?? 1;
    const cardRate = card?.discountRate ?? 1;
    return {
      rate: Math.min(levelRate, cardRate),
      levelName: user?.level?.name ?? '访客',
      cardName: card?.planName ?? null,
      freeShipping: card?.freeShipping ?? false,
    };
  }

  /** 8 位随机核销码，唯一约束兜底 */
  private async generatePickupCode(tx: TxClient): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = String(Math.floor(10_000_000 + Math.random() * 90_000_000));
      const existing = await tx.order.findUnique({
        where: { pickupCode: code },
        select: { id: true },
      });
      if (!existing) return code;
    }
    throw new ConflictException('核销码生成失败，请重试');
  }

  /** 自提时段：必须在门店营业时间内，返回具体到店时间与门店快照 */
  private pickupInfo(store: FulfillmentStore, slot: string | undefined, required: boolean) {
    const storeView = {
      id: store.id,
      name: store.name,
      phone: store.phone,
      region: store.region,
      address: store.address,
      businessHours: store.businessHours,
    };
    if (!slot) {
      if (required) throw new BadRequestException('请选择自提时段');
      return { store: storeView, slot: null, pickupAt: null };
    }

    const matched = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.exec(slot);
    if (!matched) throw new BadRequestException('自提时段格式需为 10:00-12:00');
    const startMin = Number(matched[1]) * 60 + Number(matched[2]);
    const endMin = Number(matched[3]) * 60 + Number(matched[4]);
    if (endMin <= startMin) throw new BadRequestException('自提时段结束时间需晚于开始时间');

    const hours = (store.businessHours ?? {}) as Record<string, string[][]>;
    const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const now = new Date();
    for (let offset = 0; offset < 7; offset += 1) {
      const day = new Date(now);
      day.setDate(now.getDate() + offset);
      const ranges = hours[weekdays[day.getDay()]]?.length
        ? hours[weekdays[day.getDay()]]
        : [['09:00', '18:00']];
      const within = ranges.some(([open, close]) => {
        const openMin = Number(open.slice(0, 2)) * 60 + Number(open.slice(3, 5));
        const closeMin = Number(close.slice(0, 2)) * 60 + Number(close.slice(3, 5));
        return openMin <= startMin && endMin <= closeMin;
      });
      if (!within) continue;

      const pickupAt = new Date(day);
      pickupAt.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
      if (pickupAt.getTime() <= now.getTime()) continue;
      return { store: storeView, slot, pickupAt };
    }
    throw new BadRequestException('该时段不在门店营业时间内，请重新选择');
  }

  /** 同城配送：区县白名单 + 时段/截单/容量校验 */
  private async deliveryInfo(
    store: FulfillmentStore,
    region: string | undefined,
    slot: string | undefined,
    required: boolean,
  ) {
    const regions = await this.prisma.storeDeliveryRegion.findMany({
      where: { storeId: store.id },
      select: { regionName: true },
    });
    const matched = matchDeliveryRegion(
      regions.map((item) => item.regionName),
      region ?? '',
    );
    if (!matched) {
      throw new BadRequestException('所选地址不在该门店配送范围内，请更换门店或收货地址');
    }
    if (!slot) {
      if (required) throw new BadRequestException('请选择配送时段');
      return { store, region: matched, slot: null };
    }

    const bookedCount = await this.deliveryBookedCount(store.id, slot);
    const check = checkDeliverySlot({
      slot,
      slots: (store.deliverySlots as string[] | null) ?? [],
      cutoff: store.deliveryCutoff,
      now: new Date(),
      bookedCount,
      maxOrdersPerSlot: store.maxOrdersPerSlot,
    });
    if (!check.ok) throw new BadRequestException(check.reason);

    return { store, region: matched, slot };
  }

  /** 当天该门店该时段已占用单量：支付前就占位，避免同一时段超卖 */
  private async deliveryBookedCount(storeId: string, slot: string): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    return this.prisma.order.count({
      where: {
        storeId,
        fulfillmentType: 'DELIVERY',
        deliverySlot: slot,
        status: { notIn: ['CLOSED', 'REFUNDED'] },
        createdAt: { gte: start, lt: end },
      },
    });
  }

  /** 配送费按会员折扣后商品金额判断满额免配送；会员包邮不参与 */
  private deliveryFeeFor(store: FulfillmentStore, amount: OrderAmount): number {
    return calculateDeliveryFee({
      goodsCents: amount.goodsCents - amount.memberDiscountCents,
      fixedFeeCents: store.deliveryFeeCents,
      freeThresholdCents: store.freeDeliveryThresholdCents,
    });
  }

  private deliveryStoreView(store: FulfillmentStore) {
    return {
      id: store.id,
      name: store.name,
      phone: store.phone,
      region: store.region,
      address: store.address,
      deliverySlots: (store.deliverySlots as string[] | null) ?? [],
      deliveryCutoff: store.deliveryCutoff,
      maxOrdersPerSlot: store.maxOrdersPerSlot,
    };
  }

  private buildFreight(
    config: { freeThresholdCents: number; flatFreightCents: number },
    region: string | undefined,
    exceptions: { regionName: string; freightCents: number }[],
    freeShipping = false,
  ) {
    // 地区例外优先于满额包邮：例外区域名可能写成「新疆 / 西藏」，按片段匹配
    const hit = region
      ? exceptions.find((e) =>
          e.regionName
            .split('/')
            .map((part) => part.trim())
            .filter(Boolean)
            .some((part) => region.includes(part)),
        )
      : undefined;

    return {
      freeThresholdCents: config.freeThresholdCents,
      // 会员卡包邮：非例外地区运费为 0；例外地区仍按例外运费
      flatCents: hit ? hit.freightCents : freeShipping ? 0 : config.flatFreightCents,
      isExceptionRegion: Boolean(hit),
      region,
    };
  }

  private async loadCoupon(userId: string, claimId: string, afterMemberCents: number) {
    const claim = await this.prisma.couponClaim.findFirst({
      where: { id: claimId, userId },
      include: { coupon: true },
    });
    if (!claim) throw new NotFoundException('优惠券不存在');
    if (claim.status !== 'UNUSED') throw new ConflictException('优惠券已使用或已失效');
    if (claim.expiresAt < new Date()) throw new ConflictException('优惠券已过期');
    if (!claim.coupon.enabled) throw new ConflictException('优惠券已停发');
    if (afterMemberCents < claim.coupon.thresholdCents) {
      const diff = ((claim.coupon.thresholdCents - afterMemberCents) / 100).toFixed(2);
      throw new ConflictException(`还差 ¥${diff} 可用该券`);
    }
    return {
      claimId: claim.id,
      name: claim.coupon.name,
      rule: {
        thresholdCents: claim.coupon.thresholdCents,
        faceValueCents: claim.coupon.faceValueCents,
      },
    };
  }

  private async listUsableCoupons(userId: string, goodsCents: number) {
    const claims = await this.prisma.couponClaim.findMany({
      where: { userId, status: 'UNUSED', expiresAt: { gt: new Date() } },
      include: { coupon: true },
      orderBy: { expiresAt: 'asc' },
    });
    return claims.map((c) => ({
      claimId: c.id,
      name: c.coupon.name,
      faceValueCents: c.coupon.faceValueCents,
      thresholdCents: c.coupon.thresholdCents,
      usable: goodsCents >= c.coupon.thresholdCents,
      expiresAt: c.expiresAt,
    }));
  }

  private async resolveLines(
    userId: string,
    items?: OrderLineInput[],
    fulfillment?: { type: FulfillmentType; storeId: string | null },
  ) {
    // 未传商品时取购物车勾选项
    const source =
      items?.length
        ? items
        : (
            await this.prisma.cartItem.findMany({
              where: { userId, checked: true },
            })
          ).map((i) => ({ skuId: i.skuId, quantity: i.quantity }));

    if (!source.length) throw new BadRequestException('没有可结算的商品');

    const skus = await this.prisma.sku.findMany({
      where: { id: { in: source.map((s) => s.skuId) } },
      include: { product: true },
    });
    const byId = new Map(skus.map((s) => [s.id, s]));
    const seckills = await this.promotions.seckillForSkus([...byId.keys()]);
    const storeAvailable = fulfillment?.storeId
      ? await this.storeInventory.availableMap(fulfillment.storeId, [...byId.keys()])
      : null;

    const view = source.map((line) => {
      const sku = byId.get(line.skuId);
      if (!sku) throw new NotFoundException('商品不存在');
      const available = storeAvailable
        ? (storeAvailable.get(sku.id) ?? 0)
        : Math.max(sku.stock - sku.reserved, 0);
      if (available < line.quantity) {
        throw new ConflictException(
          storeAvailable
            ? `门店库存不足，${sku.product.title} 仅剩 ${available} 件`
            : `库存不足，${sku.product.title} 仅剩 ${available} 件`,
        );
      }
      const seckill = seckills.get(sku.id);
      const unitPrice = seckill ? Math.min(seckill.priceCents, sku.priceCents) : sku.priceCents;
      return {
        skuId: sku.id,
        productId: sku.productId,
        categoryId: sku.product.categoryId,
        title: sku.product.title,
        specText: Object.values(sku.specJson as Record<string, string>).join(' / '),
        imageKey: sku.product.mainImageKey,
        priceCents: unitPrice,
        originalPriceCents: sku.priceCents,
        quantity: line.quantity,
        subtotalCents: unitPrice * line.quantity,
        isSeckill: Boolean(seckill),
        seckillName: seckill?.promotionName ?? null,
      };
    });

    const normalGoodsCents = view
      .filter((item) => !item.isSeckill)
      .reduce((sum, item) => sum + item.subtotalCents, 0);

    return {
      items: view.map((item) => ({
        priceCents: item.priceCents,
        quantity: item.quantity,
        seckill: item.isSeckill,
      })),
      lines: view.map((item) => ({
        productId: item.productId,
        categoryId: item.categoryId,
        seckill: item.isSeckill,
      })),
      goodsCents: view.reduce((sum, item) => sum + item.subtotalCents, 0),
      normalGoodsCents,
      view,
    };
  }
}

export type { OrderAmount };
