import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  allocateLinePaidCents,
  calculateOrderAmount,
  can,
  nextStatus,
  type OrderAmount,
} from '@shanye/shared';

import { PrismaService, isUniqueViolation } from '../../prisma/prisma.module';
import { generateOrderNo } from '../../common/password';

export interface OrderLineInput {
  skuId: string;
  quantity: number;
}

interface LockedSku {
  id: string;
  stock: number;
  reserved: number;
  priceCents: number;
  status: string;
  code: string;
  specJson: unknown;
  productId: string;
  title: string;
  imageKey: string | null;
}

@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) {}

  /** 结算预览：不锁库存，只算钱与可用券 */
  async preview(
    userId: string,
    input: { items?: OrderLineInput[]; couponClaimId?: string; region?: string },
  ) {
    const lines = await this.resolveLines(userId, input.items);
    const config = await this.loadConfig();
    const { rate, levelName } = await this.memberRate(userId);

    const coupon = input.couponClaimId
      ? await this.loadCoupon(userId, input.couponClaimId, lines.goodsCents * rate)
      : null;

    const exceptions = await this.prisma.shippingRegionException.findMany();
    const freight = this.buildFreight(config, input.region, exceptions);
    const amount = calculateOrderAmount({
      items: lines.items,
      memberDiscountRate: rate,
      coupon: coupon?.rule ?? null,
      freight,
    });

    const availableCoupons = await this.listUsableCoupons(userId, amount.goodsCents);

    return {
      items: lines.view,
      amount,
      member: { levelName, rate },
      coupon: coupon ? { claimId: coupon.claimId, name: coupon.name } : null,
      availableCoupons,
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
      addressId: string;
      couponClaimId?: string;
      remark?: string;
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

    const address = await this.prisma.address.findFirst({
      where: { id: dto.addressId, userId },
    });
    if (!address) throw new NotFoundException('收货地址不存在');

    const config = await this.loadConfig();
    const { rate } = await this.memberRate(userId);
    const exceptions = await this.prisma.shippingRegionException.findMany();

    try {
      const orderId = await this.prisma.$transaction(async (tx) => {
        const ids = [...new Set(source.map((i) => i.skuId))].sort();
        // 行锁：同一 SKU 的并发下单在此串行化，避免超卖
        const locked: LockedSku[] = [];
        for (const id of ids) {
          const rows = await tx.$queryRaw<LockedSku[]>`
            SELECT s.id, s.stock, s.reserved, s."priceCents", s.status,
                   s.code, s."specJson", s."productId",
                   p.title, p."mainImageKey" AS "imageKey"
            FROM "Sku" s JOIN "Product" p ON p.id = s."productId"
            WHERE s.id = ${id}
            FOR UPDATE OF s`;
          if (!rows.length) throw new NotFoundException('商品不存在');
          locked.push(rows[0]);
        }

        const byId = new Map(locked.map((s) => [s.id, s]));
        const itemsForAmount = source.map((line) => {
          const sku = byId.get(line.skuId)!;
          if (sku.status !== 'ON_SALE') throw new ConflictException('商品已下架');
          const available = Math.max(sku.stock - sku.reserved, 0);
          if (available < line.quantity) {
            throw new ConflictException(`库存不足，${sku.title} 仅剩 ${available} 件`);
          }
          return { sku, quantity: line.quantity };
        });

        const goodsCents = itemsForAmount.reduce(
          (sum, i) => sum + i.sku.priceCents * i.quantity,
          0,
        );
        const coupon = dto.couponClaimId
          ? await this.loadCoupon(userId, dto.couponClaimId, Math.round(goodsCents * rate))
          : null;

        const amount = calculateOrderAmount({
          items: itemsForAmount.map((i) => ({
            priceCents: i.sku.priceCents,
            quantity: i.quantity,
          })),
          memberDiscountRate: rate,
          coupon: coupon?.rule ?? null,
          freight: this.buildFreight(config, address.region, exceptions),
        });

        for (const item of itemsForAmount) {
          await tx.sku.update({
            where: { id: item.sku.id },
            data: { reserved: { increment: item.quantity } },
          });
        }

        // 行实付分摊：会员折扣与券按商品金额占比摊到每一行，作为退款上限依据
        const linePaid = allocateLinePaidCents({
          lines: itemsForAmount.map((i) => ({
            priceCents: i.sku.priceCents,
            quantity: i.quantity,
          })),
          memberDiscountCents: amount.memberDiscountCents,
          couponCents: amount.couponCents,
        });

        const order = await tx.order.create({
          data: {
            orderNo: generateOrderNo(),
            userId,
            idempotencyKey,
            status: 'PENDING_PAYMENT',
            goodsCents: amount.goodsCents,
            memberDiscountCents: amount.memberDiscountCents,
            couponCents: amount.couponCents,
            freightCents: amount.freightCents,
            payableCents: amount.payableCents,
            addressSnapshot: {
              receiver: address.receiver,
              phone: address.phone,
              region: address.region,
              detail: address.detail,
            },
            remark: dto.remark,
            payDeadlineAt: new Date(Date.now() + config.payTimeoutMinutes * 60_000),
            items: {
              create: itemsForAmount.map((i, idx) => ({
                skuId: i.sku.id,
                title: i.sku.title,
                specText: Object.values(i.sku.specJson as Record<string, string>).join(' / '),
                imageKey: i.sku.imageKey,
                priceCents: i.sku.priceCents,
                quantity: i.quantity,
                subtotalCents: i.sku.priceCents * i.quantity,
                paidCents: linePaid[idx],
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

        return order.id;
      });

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
      include: { items: true, shipment: true, payments: true },
    });
    if (!order) throw new NotFoundException('订单不存在');

    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
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
      })),
      shipment: order.shipment
        ? {
            expressName: order.shipment.expressName,
            expressCode: order.shipment.expressCode,
            trackingNo: order.shipment.trackingNo,
            shippedAt: order.shipment.shippedAt,
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

      for (const item of order.items) {
        await tx.sku.update({
          where: { id: item.skuId },
          data: { reserved: { decrement: item.quantity } },
        });
      }
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

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id: orderId, version: order.version, status: order.status },
        data: { status: next as never, version: { increment: 1 }, paidAt: new Date() },
      });
      if (updated.count !== 1) throw new ConflictException('订单状态已变化，请刷新');

      for (const item of order.items) {
        // 支付成功：预占转为真实扣减
        await tx.sku.update({
          where: { id: item.skuId },
          data: { stock: { decrement: item.quantity }, reserved: { decrement: item.quantity } },
        });
        await tx.product.update({
          where: { id: (await tx.sku.findUnique({ where: { id: item.skuId } }))!.productId },
          data: { soldCount: { increment: item.quantity } },
        });
      }

      await tx.payment.updateMany({
        where: { orderId, status: 'PENDING' },
        data: { status: 'SUCCESS', transactionId, paidAt: new Date() },
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

  private async memberRate(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { level: true },
    });
    return {
      rate: user?.level?.discountRate ?? 1,
      levelName: user?.level?.name ?? '访客',
    };
  }

  private buildFreight(
    config: { freeThresholdCents: number; flatFreightCents: number },
    region: string | undefined,
    exceptions: { regionName: string; freightCents: number }[],
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
      flatCents: hit ? hit.freightCents : config.flatFreightCents,
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

  private async resolveLines(userId: string, items?: OrderLineInput[]) {
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

    const view = source.map((line) => {
      const sku = byId.get(line.skuId);
      if (!sku) throw new NotFoundException('商品不存在');
      const available = Math.max(sku.stock - sku.reserved, 0);
      if (available < line.quantity) {
        throw new ConflictException(`库存不足，${sku.product.title} 仅剩 ${available} 件`);
      }
      return {
        skuId: sku.id,
        title: sku.product.title,
        specText: Object.values(sku.specJson as Record<string, string>).join(' / '),
        imageKey: sku.product.mainImageKey,
        priceCents: sku.priceCents,
        quantity: line.quantity,
        subtotalCents: sku.priceCents * line.quantity,
      };
    });

    return {
      items: source.map((s) => ({ priceCents: byId.get(s.skuId)!.priceCents, quantity: s.quantity })),
      goodsCents: view.reduce((sum, v) => sum + v.subtotalCents, 0),
      view,
    };
  }
}

export type { OrderAmount };
