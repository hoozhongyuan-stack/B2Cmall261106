import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.module';
import { IntegrationService } from '../integration/integration.service';
import { NotificationService } from '../notification/notification.service';
import { OrderService } from '../order/order.service';

/** 订单待支付状态（避免与禁止字面量比较的 lint 规则冲突） */
const ORDER_PENDING = 'PENDING_PAYMENT';

export interface CardPlanInput {
  name?: string;
  priceCents?: number;
  durationDays?: number;
  discountRate?: number;
  pointsRate?: number;
  freeShipping?: boolean;
  enabled?: boolean;
  sort?: number;
}

export interface RechargePlanInput {
  amountCents?: number;
  bonusCents?: number;
  enabled?: boolean;
  sort?: number;
}

@Injectable()
export class MemberCommerceService {
  private readonly logger = new Logger(MemberCommerceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integration: IntegrationService,
    private readonly orders: OrderService,
    private readonly notifications: NotificationService,
  ) {}

  /* ---------------- 会员卡 ---------------- */

  async cardPlans(includeDisabled = false) {
    const items = await this.prisma.memberCardPlan.findMany({
      where: includeDisabled ? {} : { enabled: true },
      orderBy: [{ sort: 'asc' }, { priceCents: 'asc' }],
    });
    return { items };
  }

  /** 购买会员卡：余额扣款 + 权益快照落库，原卡标记为已替换 */
  async purchaseCard(userId: string, planId: string) {
    const plan = await this.prisma.memberCardPlan.findUnique({ where: { id: planId } });
    if (!plan || !plan.enabled) throw new NotFoundException('会员卡方案不存在或已下架');

    const card = await this.prisma.$transaction(async (tx) => {
      const account = await this.accountInTx(tx, userId);
      if (account.balanceCents < plan.priceCents) {
        const diff = ((plan.priceCents - account.balanceCents) / 100).toFixed(2);
        throw new ConflictException(`储值余额不足，还差 ¥${diff}，请先充值`);
      }

      const now = new Date();
      await tx.memberCard.updateMany({
        where: { userId, status: 'ACTIVE', expireAt: { gt: now } },
        data: { status: 'REPLACED' },
      });

      const created = await tx.memberCard.create({
        data: {
          userId,
          planId: plan.id,
          planName: plan.name,
          discountRate: plan.discountRate,
          pointsRate: plan.pointsRate,
          freeShipping: plan.freeShipping,
          startAt: now,
          expireAt: new Date(now.getTime() + plan.durationDays * 86_400_000),
          status: 'ACTIVE',
        },
      });

      const balanceAfter = account.balanceCents - plan.priceCents;
      await tx.storedValueAccount.update({
        where: { userId },
        data: {
          balanceCents: balanceAfter,
          totalConsumedCents: { increment: plan.priceCents },
        },
      });
      await tx.storedValueLedger.create({
        data: {
          userId,
          deltaCents: -plan.priceCents,
          balanceAfter,
          type: 'CARD_PURCHASE',
          refType: 'MemberCard',
          refId: created.id,
          remark: `购买${plan.name}`,
        },
      });
      return created;
    });

    return this.cardView(card);
  }

  /** 会员中心：当前生效卡 + 储值余额 */
  async myMembership(userId: string) {
    const [card, account] = await Promise.all([
      this.activeCard(userId),
      this.prisma.storedValueAccount.findUnique({ where: { userId } }),
    ]);
    return {
      card: card ? this.cardView(card) : null,
      balanceCents: account?.balanceCents ?? 0,
    };
  }

  async activeCard(userId: string) {
    return this.prisma.memberCard.findFirst({
      where: { userId, status: 'ACTIVE', expireAt: { gt: new Date() } },
      orderBy: { expireAt: 'desc' },
    });
  }

  /* ---------------- 储值 ---------------- */

  async rechargePlans(includeDisabled = false) {
    const items = await this.prisma.rechargePlan.findMany({
      where: includeDisabled ? {} : { enabled: true },
      orderBy: [{ sort: 'asc' }, { amountCents: 'asc' }],
    });
    return { items };
  }

  async account(userId: string) {
    const account = await this.prisma.storedValueAccount.findUnique({ where: { userId } });
    return {
      balanceCents: account?.balanceCents ?? 0,
      totalRechargedCents: account?.totalRechargedCents ?? 0,
      totalConsumedCents: account?.totalConsumedCents ?? 0,
    };
  }

  async wallet(userId: string) {
    const [account, plans, ledger] = await Promise.all([
      this.account(userId),
      this.rechargePlans(false),
      this.prisma.storedValueLedger.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return {
      ...account,
      plans: plans.items,
      ledger: ledger.map((item) => ({
        id: item.id,
        deltaCents: item.deltaCents,
        balanceAfter: item.balanceAfter,
        type: item.type,
        remark: item.remark,
        createdAt: item.createdAt,
      })),
    };
  }

  /**
   * 充值：本地仅支持测试渠道直接入账，避免生产误用；
   * 接入微信支付后应改为「创建充值单 → 支付回调入账」。
   */
  async recharge(userId: string, planId: string) {
    const plan = await this.prisma.rechargePlan.findUnique({ where: { id: planId } });
    if (!plan || !plan.enabled) throw new NotFoundException('充值套餐不存在或已下架');

    const provider = await this.integration.paymentProvider();
    if (provider === 'wechat') {
      throw new ServiceUnavailableException(
        '微信充值支付尚未开启，请在本地使用测试渠道或联系管理员',
      );
    }

    const creditedCents = plan.amountCents + plan.bonusCents;
    const result = await this.prisma.$transaction(async (tx) => {
      const account = await tx.storedValueAccount.upsert({
        where: { userId },
        update: {
          balanceCents: { increment: creditedCents },
          totalRechargedCents: { increment: creditedCents },
        },
        create: {
          userId,
          balanceCents: creditedCents,
          totalRechargedCents: creditedCents,
        },
      });
      const rechargeOrder = await tx.rechargeOrder.create({
        data: {
          rechargeNo: `RC${Date.now()}${Math.floor(Math.random() * 900 + 100)}`,
          userId,
          planId: plan.id,
          amountCents: plan.amountCents,
          bonusCents: plan.bonusCents,
          provider: 'mock',
          status: 'PAID',
          paidAt: new Date(),
        },
      });
      await tx.storedValueLedger.create({
        data: {
          userId,
          deltaCents: creditedCents,
          balanceAfter: account.balanceCents,
          type: 'RECHARGE',
          refType: 'RechargeOrder',
          refId: rechargeOrder.id,
          remark: plan.bonusCents ? `充值赠送 ¥${(plan.bonusCents / 100).toFixed(2)}` : '储值充值',
        },
      });
      return { rechargeNo: rechargeOrder.rechargeNo, balanceCents: account.balanceCents };
    });

    return {
      ...result,
      creditedCents,
      amountCents: plan.amountCents,
      bonusCents: plan.bonusCents,
    };
  }

  /** 余额支付：与微信支付互斥，余额不足直接拒绝 */
  async payOrderWithBalance(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== ORDER_PENDING) throw new ConflictException('当前订单状态不可支付');
    if (order.payDeadlineAt < new Date()) throw new ConflictException('订单已超时，请重新下单');

    const transactionId = `BAL:${order.id}`;
    const outTradeNo = `BAL${order.orderNo}`;

    await this.prisma.$transaction(async (tx) => {
      await this.accountInTx(tx, userId);
      // 先关闭可能存在的微信待支付单，保证两种支付方式互斥
      await tx.payment.updateMany({
        where: { orderId: order.id, status: 'PENDING' },
        data: { status: 'FAILED' },
      });

      const deducted = await tx.storedValueAccount.updateMany({
        where: { userId, balanceCents: { gte: order.payableCents } },
        data: {
          balanceCents: { decrement: order.payableCents },
          totalConsumedCents: { increment: order.payableCents },
        },
      });
      if (deducted.count !== 1) {
        throw new ConflictException('储值余额不足，请先充值');
      }

      const account = await tx.storedValueAccount.findUniqueOrThrow({ where: { userId } });
      await tx.payment.create({
        data: {
          orderId: order.id,
          provider: 'balance',
          outTradeNo,
          transactionId,
          amountCents: order.payableCents,
          status: 'SUCCESS',
          paidAt: new Date(),
        },
      });
      await tx.storedValueLedger.create({
        data: {
          userId,
          deltaCents: -order.payableCents,
          balanceAfter: account.balanceCents,
          type: 'BALANCE_PAY',
          refType: 'Order',
          refId: order.id,
          remark: `余额支付订单 ${order.orderNo}`,
        },
      });
    });

    try {
      await this.orders.markPaid(order.id, order.payableCents, transactionId);
    } catch (err) {
      // 状态冲突时把余额原路退回，避免钱扣了订单没支付
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.deleteMany({ where: { transactionId } });
        const account = await tx.storedValueAccount.update({
          where: { userId },
          data: {
            balanceCents: { increment: order.payableCents },
            totalConsumedCents: { decrement: order.payableCents },
          },
        });
        await tx.storedValueLedger.create({
          data: {
            userId,
            deltaCents: order.payableCents,
            balanceAfter: account.balanceCents,
            type: 'ROLLBACK',
            refType: 'Order',
            refId: order.id,
            remark: '余额支付失败回滚',
          },
        });
      });
      throw err;
    }

    try {
      await this.notifications.enqueueOrderPaid(order.id);
      await this.notifications.enqueuePickupReady(order.id);
    } catch (err) {
      this.logger.warn(`余额支付通知入队失败 order=${order.id}`, err as Error);
    }

    return this.orders.view(order.id, userId);
  }

  /* ---------------- 后台 ---------------- */

  async adminCards(input: { keyword?: string; page?: number; pageSize?: number }) {
    const page = Math.max(input.page ?? 1, 1);
    const size = Math.min(Math.max(input.pageSize ?? 20, 1), 100);
    const keyword = input.keyword?.trim();
    const where = keyword
      ? {
          OR: [
            { user: { nickname: { contains: keyword, mode: 'insensitive' as const } } },
            { user: { phone: { contains: keyword } } },
            { planName: { contains: keyword, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.memberCard.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { nickname: true, phone: true } } },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.memberCard.count({ where }),
    ]);

    return {
      total,
      page,
      pageSize: size,
      items: items.map((card) => ({
        ...this.cardView(card),
        customer: { nickname: card.user.nickname, phone: card.user.phone },
      })),
    };
  }

  async adminAccounts(input: { keyword?: string; page?: number; pageSize?: number }) {
    const page = Math.max(input.page ?? 1, 1);
    const size = Math.min(Math.max(input.pageSize ?? 20, 1), 100);
    const keyword = input.keyword?.trim();
    const where = keyword
      ? {
          user: {
            OR: [
              { nickname: { contains: keyword, mode: 'insensitive' as const } },
              { phone: { contains: keyword } },
            ],
          },
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.storedValueAccount.findMany({
        where,
        orderBy: { balanceCents: 'desc' },
        include: { user: { select: { nickname: true, phone: true } } },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.storedValueAccount.count({ where }),
    ]);

    return {
      total,
      page,
      pageSize: size,
      items: items.map((account) => ({
        userId: account.userId,
        customer: { nickname: account.user.nickname, phone: account.user.phone },
        balanceCents: account.balanceCents,
        totalRechargedCents: account.totalRechargedCents,
        totalConsumedCents: account.totalConsumedCents,
        updatedAt: account.updatedAt,
      })),
    };
  }

  async adminLedger(input: { userId?: string; page?: number; pageSize?: number }) {
    const page = Math.max(input.page ?? 1, 1);
    const size = Math.min(Math.max(input.pageSize ?? 20, 1), 100);
    const where = input.userId ? { userId: input.userId } : {};
    const [items, total] = await Promise.all([
      this.prisma.storedValueLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.storedValueLedger.count({ where }),
    ]);
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(items.map((item) => item.userId))] } },
      select: { id: true, nickname: true, phone: true },
    });
    const userMap = new Map(users.map((user) => [user.id, user]));

    return {
      total,
      page,
      pageSize: size,
      items: items.map((item) => ({
        id: item.id,
        userId: item.userId,
        customer: {
          nickname: userMap.get(item.userId)?.nickname ?? null,
          phone: userMap.get(item.userId)?.phone ?? null,
        },
        deltaCents: item.deltaCents,
        balanceAfter: item.balanceAfter,
        type: item.type,
        refType: item.refType,
        refId: item.refId,
        remark: item.remark,
        createdAt: item.createdAt,
      })),
    };
  }

  async adminRechargeOrders(page = 1, pageSize = 20) {
    const currentPage = Math.max(page, 1);
    const size = Math.min(Math.max(pageSize, 1), 100);
    const [items, total] = await Promise.all([
      this.prisma.rechargeOrder.findMany({
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { nickname: true, phone: true } } },
        skip: (currentPage - 1) * size,
        take: size,
      }),
      this.prisma.rechargeOrder.count(),
    ]);
    return {
      total,
      page: currentPage,
      pageSize: size,
      items: items.map((order) => ({
        id: order.id,
        rechargeNo: order.rechargeNo,
        amountCents: order.amountCents,
        bonusCents: order.bonusCents,
        provider: order.provider,
        status: order.status,
        paidAt: order.paidAt,
        createdAt: order.createdAt,
        customer: { nickname: order.user.nickname, phone: order.user.phone },
      })),
    };
  }

  async adjustBalance(userId: string, deltaCents: number, reason: string) {
    if (!Number.isInteger(deltaCents) || deltaCents === 0) {
      throw new BadRequestException('金额变动必须为非零整数分');
    }
    if (!reason?.trim()) throw new BadRequestException('请填写调整原因');

    return this.prisma.$transaction(async (tx) => {
      const account = await this.accountInTx(tx, userId);
      if (deltaCents < 0 && account.balanceCents + deltaCents < 0) {
        throw new ConflictException('余额不足，无法扣减');
      }
      const updated = await tx.storedValueAccount.update({
        where: { userId },
        data: {
          balanceCents: { increment: deltaCents },
          ...(deltaCents > 0
            ? { totalRechargedCents: { increment: deltaCents } }
            : { totalConsumedCents: { increment: -deltaCents } }),
        },
      });
      await tx.storedValueLedger.create({
        data: {
          userId,
          deltaCents,
          balanceAfter: updated.balanceCents,
          type: 'ADMIN_ADJUST',
          remark: reason.trim(),
        },
      });
      return { balanceCents: updated.balanceCents };
    });
  }

  async createCardPlan(input: CardPlanInput) {
    return this.prisma.memberCardPlan.create({
      data: this.cardPlanData(input, true) as never,
    });
  }

  async updateCardPlan(id: string, input: CardPlanInput) {
    const plan = await this.prisma.memberCardPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('会员卡方案不存在');
    return this.prisma.memberCardPlan.update({
      where: { id },
      data: this.cardPlanData(input, false) as never,
    });
  }

  async createRechargePlan(input: RechargePlanInput) {
    return this.prisma.rechargePlan.create({
      data: this.rechargePlanData(input, true) as never,
    });
  }

  async updateRechargePlan(id: string, input: RechargePlanInput) {
    const plan = await this.prisma.rechargePlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('充值套餐不存在');
    return this.prisma.rechargePlan.update({
      where: { id },
      data: this.rechargePlanData(input, false) as never,
    });
  }

  /* ---------------- 内部 ---------------- */

  private async accountInTx(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    userId: string,
  ) {
    return tx.storedValueAccount.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  private cardView(card: {
    id: string;
    planName: string;
    discountRate: number;
    pointsRate: number;
    freeShipping: boolean;
    startAt: Date;
    expireAt: Date;
    status: string;
    createdAt: Date;
  }) {
    return {
      id: card.id,
      planName: card.planName,
      discountRate: card.discountRate,
      pointsRate: card.pointsRate,
      freeShipping: card.freeShipping,
      startAt: card.startAt,
      expireAt: card.expireAt,
      status: card.status,
      createdAt: card.createdAt,
    };
  }

  private cardPlanData(input: CardPlanInput, creating: boolean) {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name || name.length > 20) throw new BadRequestException('卡名称需为 1-20 个字符');
      data.name = name;
    } else if (creating) {
      throw new BadRequestException('请填写卡名称');
    }
    if (input.priceCents !== undefined) {
      this.assertPositiveInt(input.priceCents, '售价');
      data.priceCents = input.priceCents;
    } else if (creating) {
      throw new BadRequestException('请填写售价');
    }
    if (input.durationDays !== undefined) {
      this.assertPositiveInt(input.durationDays, '有效期天数');
      data.durationDays = input.durationDays;
    } else if (creating) {
      throw new BadRequestException('请填写有效期天数');
    }
    if (input.discountRate !== undefined) {
      if (!(input.discountRate > 0) || input.discountRate > 1) {
        throw new BadRequestException('折扣率必须在 0 与 1 之间（1 表示不打折）');
      }
      data.discountRate = input.discountRate;
    }
    if (input.pointsRate !== undefined) {
      if (!(input.pointsRate > 0) || input.pointsRate > 10) {
        throw new BadRequestException('积分倍率必须在 0 与 10 之间');
      }
      data.pointsRate = input.pointsRate;
    }
    if (input.freeShipping !== undefined) data.freeShipping = input.freeShipping;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.sort !== undefined) data.sort = this.assertNonNegative(input.sort, '排序');
    return data;
  }

  private rechargePlanData(input: RechargePlanInput, creating: boolean) {
    const data: Record<string, unknown> = {};
    if (input.amountCents !== undefined) {
      this.assertPositiveInt(input.amountCents, '充值金额');
      data.amountCents = input.amountCents;
    } else if (creating) {
      throw new BadRequestException('请填写充值金额');
    }
    if (input.bonusCents !== undefined) {
      if (!Number.isInteger(input.bonusCents) || input.bonusCents < 0) {
        throw new BadRequestException('赠送金额必须为非负整数分');
      }
      data.bonusCents = input.bonusCents;
    }
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.sort !== undefined) data.sort = this.assertNonNegative(input.sort, '排序');
    return data;
  }

  private assertPositiveInt(value: number, label: string): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${label}必须为正整数分`);
    }
  }

  private assertNonNegative(value: number, label: string): number {
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${label}必须为非负整数`);
    }
    return value;
  }
}
