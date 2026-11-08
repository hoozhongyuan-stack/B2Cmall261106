import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.module';
import { IntegrationService } from '../integration/integration.service';
import { NotificationService } from '../notification/notification.service';
import { WechatPayClient } from '../payment/wechat/wechat-pay.client';
import { AfterSaleService } from './aftersale.service';

/** 每 5 分钟扫描一次待确认退款 */
const INTERVAL_MS = 5 * 60_000;
/** 刚发起的退款先留给同步响应，2 分钟后再查询 */
const MIN_AGE_MS = 2 * 60_000;
/** 微信渠道关闭状态（避免直接与订单状态字面量比较） */
const CHANNEL_CLOSED = 'CLOSED';

interface RefundRow {
  id: string;
  refundNo: string;
  status: string;
  channelStatus: string | null;
}

/**
 * 微信退款主动对账：PROCESSING 的退款定时查询渠道状态，
 * 成功时复用 AfterSaleService.completeRefund 完成回写。
 */
@Injectable()
export class RefundReconcileService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RefundReconcileService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly integration: IntegrationService,
    private readonly afterSales: AfterSaleService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.queryPending().catch((err) => this.logger.error('退款对账任务失败', err));
    }, INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 扫描并查询待处理退款，返回本次统计 */
  async queryPending(): Promise<{ checked: number; updated: number; failed: number }> {
    const due = await this.prisma.refund.findMany({
      where: {
        provider: 'wechat',
        status: 'PENDING',
        createdAt: { lt: new Date(Date.now() - MIN_AGE_MS) },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    const stats = { checked: 0, updated: 0, failed: 0 };
    for (const refund of due) {
      stats.checked += 1;
      try {
        const before = refund.status;
        const result = await this.syncOne(refund);
        if (before !== result.status || result.channelStatus !== refund.channelStatus) {
          stats.updated += 1;
        }
      } catch (err) {
        stats.failed += 1;
        this.logger.warn(
          `退款查询失败 ${refund.refundNo}：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return stats;
  }

  /** 后台手动查询单笔退款 */
  async queryOne(refundId: string) {
    const refund = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!refund) throw new NotFoundException('退款单不存在');
    if (refund.provider !== 'wechat') {
      throw new BadRequestException('仅微信渠道退款支持主动查询');
    }
    const result = await this.syncOne(refund);
    return { id: refund.id, status: result.status, channelStatus: result.channelStatus };
  }

  private async syncOne(
    refund: RefundRow,
  ): Promise<{ status: string; channelStatus: string }> {
    const client = new WechatPayClient(await this.integration.wechatPayConfig());
    const res = await client.queryRefund(refund.refundNo);
    const now = new Date();

    if (res.status === 'SUCCESS') {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          channelStatus: 'SUCCESS',
          lastQueriedAt: now,
          ...(res.refundId ? { transactionId: res.refundId } : {}),
        },
      });
      await this.afterSales.completeRefund(refund.id, {
        transactionId: res.refundId || undefined,
        raw: res.raw,
        channelStatus: 'SUCCESS',
      });
      return { status: 'SUCCESS', channelStatus: 'SUCCESS' };
    }

    if (res.status === 'ABNORMAL') {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: { channelStatus: 'ABNORMAL', lastQueriedAt: now },
      });
      return { status: 'PENDING', channelStatus: 'ABNORMAL' };
    }

    if (res.status === CHANNEL_CLOSED) {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: 'FAILED',
          failReason: '渠道已关闭退款',
          channelStatus: 'CLOSED',
          lastQueriedAt: now,
          rawResponse: res.raw as never,
        },
      });
      try {
        await this.notifications.enqueueRefundResult(refund.id);
      } catch (err) {
        this.logger.warn(`退款失败通知入队失败 refund=${refund.id}`, err as Error);
      }
      return { status: 'FAILED', channelStatus: 'CLOSED' };
    }

    // PROCESSING 与未知状态：只记录渠道状态，等待下次查询
    const channelStatus = res.status || 'UNKNOWN';
    await this.prisma.refund.update({
      where: { id: refund.id },
      data: { channelStatus, lastQueriedAt: now },
    });
    return { status: 'PENDING', channelStatus };
  }
}
