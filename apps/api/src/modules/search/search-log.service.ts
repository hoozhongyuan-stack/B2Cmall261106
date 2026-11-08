import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.module';

const KEYWORD_MAX_LENGTH = 50;

export interface SearchKeywordStat {
  keyword: string;
  count: number;
}

export interface SearchStats {
  range: { days: number; since: Date };
  total: number;
  topKeywords: SearchKeywordStat[];
  noResultKeywords: SearchKeywordStat[];
}

/** 搜索日志：写入与聚合统计（热词只由日志聚合，不做人工维护） */
@Injectable()
export class SearchLogService {
  private readonly logger = new Logger(SearchLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 归一化关键词：去首尾空格、转小写、截断超长输入 */
  normalizeKeyword(keyword: string): string {
    return keyword.trim().toLowerCase().slice(0, KEYWORD_MAX_LENGTH);
  }

  /** 记录搜索：异步写入，失败只告警，不影响搜索结果返回 */
  record(input: { keyword: string; resultCount: number; userId?: string }): void {
    const keyword = this.normalizeKeyword(input.keyword);
    if (!keyword) return;
    void this.prisma.searchLog
      .create({
        data: { keyword, resultCount: Math.max(input.resultCount, 0), userId: input.userId ?? null },
      })
      .catch((error) => this.logger.warn(`搜索日志写入失败：${String(error)}`));
  }

  /** 热门搜索词：近 30 天有结果的搜索按次数排序，供小程序展示 */
  async hotKeywords(limit = 10): Promise<string[]> {
    const take = Math.min(Math.max(Number(limit) || 10, 1), 20);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await this.prisma.searchLog.groupBy({
      by: ['keyword'],
      where: { createdAt: { gte: since }, resultCount: { gt: 0 } },
      _count: { _all: true },
      orderBy: [{ _count: { keyword: 'desc' as const } }, { keyword: 'asc' as const }],
      take,
    });
    return rows.map((row) => row.keyword);
  }

  async stats(days = 30, limit = 10): Promise<SearchStats> {
    const rangeDays = Math.min(Math.max(Number(days) || 30, 1), 365);
    const take = Math.min(Math.max(Number(limit) || 10, 1), 50);
    const since = new Date(Date.now() - rangeDays * 86_400_000);
    const where = { createdAt: { gte: since } };
    const orderBy = [{ _count: { keyword: 'desc' as const } }, { keyword: 'asc' as const }];

    const [total, topKeywords, noResultKeywords] = await Promise.all([
      this.prisma.searchLog.count({ where }),
      this.prisma.searchLog.groupBy({
        by: ['keyword'],
        where,
        _count: { _all: true },
        orderBy,
        take,
      }),
      this.prisma.searchLog.groupBy({
        by: ['keyword'],
        where: { ...where, resultCount: 0 },
        _count: { _all: true },
        orderBy,
        take,
      }),
    ]);

    return {
      range: { days: rangeDays, since },
      total,
      topKeywords: topKeywords.map((row) => ({ keyword: row.keyword, count: row._count._all })),
      noResultKeywords: noResultKeywords.map((row) => ({
        keyword: row.keyword,
        count: row._count._all,
      })),
    };
  }
}
