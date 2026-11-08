import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { readdir, stat, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { PrismaService } from '../../prisma/prisma.module';
import { uploadRoot } from '../../common/media';
import { IntegrationService } from '../integration/integration.service';

/** 每 10 分钟检查一次并在日志中输出告警 */
const INTERVAL_MS = 10 * 60_000;
const DISK_WARN_RATIO = 0.85;
const DISK_ERROR_RATIO = 0.95;
/** 备份超过 48 小时视为过期 */
const BACKUP_MAX_AGE_HOURS = 48;
/** 待处理退款超过 24 小时提醒 */
const REFUND_PENDING_WARN_HOURS = 24;

export interface OpsAlert {
  level: 'warn' | 'error';
  code: string;
  message: string;
}

@Injectable()
export class OpsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OpsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly integration: IntegrationService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.checkAlerts().catch((err) => this.logger.error('系统状态检查失败', err));
    }, INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 系统状态：磁盘、备份、通知、退款与配置检查 */
  async status() {
    const diskPath = uploadRoot();
    const [disk, backup, notifications, refunds, provider, templates] = await Promise.all([
      this.diskStatus(diskPath),
      this.backupStatus(),
      this.notificationStatus(),
      this.refundStatus(),
      this.integration.paymentProvider(),
      this.integration.subscribeTemplateConfig(),
    ]);

    const alerts: OpsAlert[] = [];

    if (disk.usedRatio >= DISK_ERROR_RATIO) {
      alerts.push({
        level: 'error',
        code: 'DISK_FULL',
        message: `磁盘使用率 ${(disk.usedRatio * 100).toFixed(1)}%，请立即清理`,
      });
    } else if (disk.usedRatio >= DISK_WARN_RATIO) {
      alerts.push({
        level: 'warn',
        code: 'DISK_HIGH',
        message: `磁盘使用率 ${(disk.usedRatio * 100).toFixed(1)}%，请关注增长`,
      });
    }

    if (backup.stale) {
      alerts.push({
        level: 'error',
        code: 'BACKUP_STALE',
        message: backup.latestAt
          ? `最近备份已 ${backup.ageHours?.toFixed(1)} 小时，超过 ${BACKUP_MAX_AGE_HOURS} 小时`
          : '尚未生成数据库备份',
      });
    }

    if (refunds.abnormal > 0) {
      alerts.push({
        level: 'error',
        code: 'REFUND_ABNORMAL',
        message: `存在 ${refunds.abnormal} 笔渠道异常退款，请尽快处理`,
      });
    }

    if (notifications.failed > 0) {
      alerts.push({
        level: 'warn',
        code: 'NOTIFICATION_FAILED',
        message: `存在 ${notifications.failed} 条发送失败的订阅消息`,
      });
    }

    if (
      refunds.oldestPendingHours !== null &&
      refunds.oldestPendingHours > REFUND_PENDING_WARN_HOURS
    ) {
      alerts.push({
        level: 'warn',
        code: 'REFUND_PENDING',
        message: `有退款待确认已超过 ${REFUND_PENDING_WARN_HOURS} 小时`,
      });
    }

    const { templates: configured } = templates;
    const subscribeConfigured = Boolean(
      configured.orderPaid && configured.orderShipped && configured.refundResult,
    );

    return {
      now: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      disk,
      backup,
      notifications,
      refunds,
      payment: { provider, subscribeConfigured },
      alerts,
    };
  }

  /** 定时检查：把告警写入结构化日志，接入日志采集后可配置阈值告警 */
  async checkAlerts(): Promise<OpsAlert[]> {
    const { alerts } = await this.status();
    for (const alert of alerts) {
      if (alert.level === 'error') this.logger.error(`[${alert.code}] ${alert.message}`);
      else this.logger.warn(`[${alert.code}] ${alert.message}`);
    }
    return alerts;
  }

  private async diskStatus(path: string) {
    try {
      const stats = await statfs(path);
      const totalBytes = stats.bsize * stats.blocks;
      const freeBytes = stats.bsize * stats.bavail;
      const usedRatio = totalBytes > 0 ? 1 - freeBytes / totalBytes : 0;
      return { path, totalBytes, freeBytes, usedRatio: Number(usedRatio.toFixed(4)) };
    } catch {
      return { path, totalBytes: 0, freeBytes: 0, usedRatio: 0 };
    }
  }

  private async backupStatus() {
    const dir = this.backupDir();
    let latestFile: string | null = null;
    let latestAt: Date | null = null;

    try {
      const files = (await readdir(dir)).filter((name) => /^shanye-.*\.sql\.gz$/.test(name));
      for (const name of files) {
        const info = await stat(join(dir, name));
        if (!latestAt || info.mtime > latestAt) {
          latestAt = info.mtime;
          latestFile = name;
        }
      }
    } catch {
      /* 目录不存在时按未备份处理 */
    }

    const ageHours = latestAt ? (Date.now() - latestAt.getTime()) / 3_600_000 : null;
    return {
      dir,
      latestFile,
      latestAt: latestAt?.toISOString() ?? null,
      ageHours: ageHours === null ? null : Number(ageHours.toFixed(2)),
      stale: latestAt === null || (ageHours ?? 0) > BACKUP_MAX_AGE_HOURS,
    };
  }

  /** 备份目录解析：BACKUP_DIR → 当前目录 → 仓库根目录 → 默认当前目录 */
  private backupDir(): string {
    if (process.env.BACKUP_DIR) return resolve(process.env.BACKUP_DIR);
    const candidates = [
      resolve(process.cwd(), 'backups'),
      resolve(process.cwd(), '..', '..', 'backups'),
    ];
    return candidates.find((dir) => existsSync(dir)) ?? candidates[0];
  }

  private async notificationStatus() {
    const [pending, failed] = await Promise.all([
      this.prisma.notificationLog.count({ where: { status: 'PENDING' } }),
      this.prisma.notificationLog.count({ where: { status: 'FAILED' } }),
    ]);
    return { pending, failed };
  }

  private async refundStatus() {
    const [pending, abnormal, oldest] = await Promise.all([
      this.prisma.refund.count({ where: { status: 'PENDING' } }),
      this.prisma.refund.count({ where: { channelStatus: 'ABNORMAL' } }),
      this.prisma.refund.findFirst({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    return {
      pending,
      abnormal,
      oldestPendingHours: oldest
        ? Number(((Date.now() - oldest.createdAt.getTime()) / 3_600_000).toFixed(2))
        : null,
    };
  }
}
