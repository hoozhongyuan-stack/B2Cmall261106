import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.module';
import { OrderService } from '../order/order.service';
import { IntegrationService } from '../integration/integration.service';
import { MockPaymentProvider, type PaymentProvider } from './payment.provider';

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly integration: IntegrationService,
  ) {}

  /**
   * 按后台「集成配置」选择渠道。
   * 微信支付实现尚未接入，选 wechat 时明确报错，避免静默走错渠道。
   */
  private async provider(): Promise<PaymentProvider> {
    const name = await this.integration.paymentProvider();
    if (name === 'wechat') {
      throw new ServiceUnavailableException('微信支付渠道尚未接入，请在集成配置中切回模拟支付');
    }
    return new MockPaymentProvider();
  }

  /** 发起支付：创建或复用待支付记录，返回渠道参数 */
  async pay(userId: string, orderId: string) {
    const provider = await this.provider();
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { payments: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'PENDING_PAYMENT') {
      throw new ConflictException('当前订单状态不可支付');
    }
    if (order.payDeadlineAt < new Date()) {
      throw new ConflictException('订单已超时，请重新下单');
    }

    let payment = order.payments.find((p) => p.status === 'PENDING');
    if (!payment) {
      payment = await this.prisma.payment.create({
        data: {
          orderId: order.id,
          provider: provider.name,
          outTradeNo: `${order.orderNo}${randomBytes(2).toString('hex').toUpperCase()}`,
          amountCents: order.payableCents,
          status: 'PENDING',
        },
      });
    }

    const params = await provider.createPayment({
      orderNo: order.orderNo,
      amountCents: payment.amountCents,
    });

    return {
      ...params,
      outTradeNo: payment.outTradeNo,
      amountCents: payment.amountCents,
      expiresAt: order.payDeadlineAt,
    };
  }

  /**
   * 模拟渠道回调 / 真实渠道回调的统一入口。
   * 幂等依据：payment.transactionId 唯一，重复处理直接返回成功。
   */
  async handleCallback(rawBody: string, headers: Record<string, string | undefined>) {
    const provider = await this.provider();
    const result = await provider.verifyCallback(headers, rawBody);

    const payment = await this.prisma.payment.findUnique({
      where: { outTradeNo: result.outTradeNo },
    });
    if (!payment) throw new NotFoundException('支付单不存在');

    if (payment.status === 'SUCCESS') {
      return { handled: false, reason: 'already_processed' };
    }

    if (result.status === 'FAILED') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', rawCallback: JSON.parse(rawBody) },
      });
      return { handled: true, status: 'FAILED' };
    }

    // 金额必须与支付单一致，否则记录异常不迁移订单
    if (payment.amountCents !== result.amountCents) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { rawCallback: JSON.parse(rawBody) },
      });
      throw new ConflictException('回调金额与支付单不一致');
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { rawCallback: JSON.parse(rawBody) },
    });

    await this.orders.markPaid(payment.orderId, result.amountCents, result.transactionId);
    return { handled: true, status: 'SUCCESS' };
  }

  /** 模拟支付：由前端点击「确认支付」触发，内部复用回调逻辑 */
  async mockConfirm(userId: string, outTradeNo: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { outTradeNo },
      include: { order: true },
    });
    if (!payment) throw new NotFoundException('支付单不存在');
    if (payment.order.userId !== userId) throw new NotFoundException('支付单不存在');

    if (payment.status === 'SUCCESS') {
      return { status: 'SUCCESS', orderNo: payment.order.orderNo };
    }

    await this.handleCallback(
      JSON.stringify({
        outTradeNo,
        amountCents: payment.amountCents,
        status: 'SUCCESS',
      }),
      {},
    );

    return { status: 'SUCCESS', orderNo: payment.order.orderNo };
  }
}
