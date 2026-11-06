import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.module';

export interface RecordOperationInput {
  actorId?: string;
  actorName?: string;
  action: string;
  targetType: string;
  targetId?: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  ip?: string;
}

export interface ListOperationQuery {
  actorId?: string;
  targetType?: string;
  keyword?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class OperationLogService {
  private readonly logger = new Logger(OperationLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 写操作日志：失败只告警，绝不影响主流程 */
  async record(input: RecordOperationInput): Promise<void> {
    try {
      if (!input.actorId) {
        this.logger.warn('缺少操作人，跳过操作日志写入');
        return;
      }
      await this.prisma.operationLog.create({
        data: {
          actorId: input.actorId,
          actorName: input.actorName ?? '',
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? '',
          beforeJson: input.beforeJson === undefined ? undefined : (input.beforeJson as never),
          afterJson: input.afterJson === undefined ? undefined : (input.afterJson as never),
          ip: input.ip,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`操作日志写入失败：${message}`);
    }
  }

  async list(query: ListOperationQuery) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

    const from = this.parseDate(query.from);
    const to = this.parseDate(query.to);
    const keyword = query.keyword?.trim();

    const where = {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(keyword
        ? {
            OR: [
              { action: { contains: keyword, mode: 'insensitive' as const } },
              { actorName: { contains: keyword, mode: 'insensitive' as const } },
              { targetId: { contains: keyword, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.operationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.operationLog.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  private parseDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
}
