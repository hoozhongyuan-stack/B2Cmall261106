import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService, type TxClient } from '../../prisma/prisma.module';
import type { AuthUser } from '../../common/auth.guards';
import { StoreScopeService } from './store-scope.service';

export interface StockAdjustInput {
  stock?: number;
  safetyStock?: number;
  status?: 'ON_SALE' | 'OFF_SHELF';
}

export interface StockListQuery {
  skuIds?: string;
  keyword?: string;
  warning?: boolean;
  page?: string;
  pageSize?: string;
}

export interface StockLogQuery {
  skuId?: string;
  page?: string;
  pageSize?: string;
}

@Injectable()
export class StoreStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: StoreScopeService,
  ) {}

  async list(user: AuthUser, storeId: string, query: StockListQuery) {
    await this.assertStore(user, storeId);
    return this.doList(storeId, query);
  }

  /** 门店小程序：负责人直接查看本店库存，不需要 AdminStore 授权 */
  async listForStore(storeId: string, query: StockListQuery) {
    return this.doList(storeId, query);
  }

  private async doList(storeId: string, query: StockListQuery) {
    const skuIds = (query.skuIds ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const page = Math.max(Number(query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100);
    const keyword = (query.keyword ?? '').trim();

    const keywordWhere = keyword
      ? {
          sku: {
            OR: [
              { code: { contains: keyword, mode: 'insensitive' as const } },
              { product: { title: { contains: keyword, mode: 'insensitive' as const } } },
            ],
          },
        }
      : {};

    const where = {
      storeId,
      ...(skuIds.length ? { skuId: { in: skuIds } } : {}),
      ...keywordWhere,
    };

    const warnings = await this.warningSkuIds(where);

    // 预警筛选无法在数据库层比较 stock-reserved 与 safetyStock，先过滤再分页
    if (query.warning) {
      const ids = warnings.slice((page - 1) * pageSize, page * pageSize);
      const rows = ids.length
        ? await this.prisma.storeSku.findMany({
            where: { storeId, skuId: { in: ids } },
            include: { sku: { include: { product: { select: { title: true, mainImageKey: true } } } } },
          })
        : [];
      const bySku = new Map(rows.map((row) => [row.skuId, row]));
      return {
        total: warnings.length,
        page,
        pageSize,
        warnings: warnings.length,
        items: ids
          .map((id) => bySku.get(id))
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .map((row) => this.viewStock(row)),
      };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.storeSku.findMany({
        where,
        include: {
          sku: {
            include: { product: { select: { title: true, mainImageKey: true } } },
          },
        },
        orderBy: { sku: { code: 'asc' } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.storeSku.count({ where }),
    ]);

    return {
      total,
      page,
      pageSize,
      warnings: warnings.length,
      items: items.map((item) => this.viewStock(item)),
    };
  }

  private async warningSkuIds(where: {
    storeId: string;
    skuId?: { in: string[] };
    sku?: unknown;
  }): Promise<string[]> {
    const rows = await this.prisma.storeSku.findMany({
      where: where as never,
      select: { skuId: true, stock: true, reserved: true, safetyStock: true },
      orderBy: { sku: { code: 'asc' } },
    });
    return rows
      .filter((row) => Math.max(row.stock - row.reserved, 0) <= row.safetyStock)
      .map((row) => row.skuId);
  }

  private viewStock(item: {
    skuId: string;
    stock: number;
    reserved: number;
    safetyStock: number;
    status: string;
    sku: {
      code: string;
      priceCents: number;
      specJson: unknown;
      product: { title: string; mainImageKey: string | null };
    };
  }) {
    return {
      skuId: item.skuId,
      code: item.sku.code,
      title: item.sku.product.title,
      specText: Object.values(item.sku.specJson as Record<string, string>).join(' / '),
      imageKey: item.sku.product.mainImageKey,
      priceCents: item.sku.priceCents,
      stock: item.stock,
      reserved: item.reserved,
      available: Math.max(item.stock - item.reserved, 0),
      safetyStock: item.safetyStock,
      warning: Math.max(item.stock - item.reserved, 0) <= item.safetyStock,
      status: item.status,
    };
  }

  /** 可添加到门店的 SKU：不受 StoreSku 是否已配置限制 */
  async skuOptions(user: AuthUser, storeId: string, query: StockListQuery) {
    await this.assertStore(user, storeId);

    const page = Math.max(Number(query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 50);
    const keyword = (query.keyword ?? '').trim();
    const where = {
      product: { status: 'ON_SALE' as const },
      ...(keyword
        ? {
            OR: [
              { code: { contains: keyword, mode: 'insensitive' as const } },
              { product: { title: { contains: keyword, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const [skus, total] = await this.prisma.$transaction([
      this.prisma.sku.findMany({
        where,
        include: {
          product: { select: { title: true, mainImageKey: true } },
          storeSkus: { where: { storeId }, take: 1 },
        },
        orderBy: { code: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.sku.count({ where }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: skus.map((sku) => {
        const row = sku.storeSkus[0];
        return {
          skuId: sku.id,
          code: sku.code,
          title: sku.product.title,
          specText: Object.values(sku.specJson as Record<string, string>).join(' / '),
          imageKey: sku.product.mainImageKey,
          priceCents: sku.priceCents,
          configured: Boolean(row),
          stock: row?.stock ?? 0,
          reserved: row?.reserved ?? 0,
          available: row ? Math.max(row.stock - row.reserved, 0) : 0,
          safetyStock: row?.safetyStock ?? 0,
          status: row?.status ?? 'ON_SALE',
        };
      }),
    };
  }

  async adjust(user: AuthUser, storeId: string, skuId: string, input: StockAdjustInput) {
    await this.assertStore(user, storeId);
    return this.prisma.$transaction((tx) =>
      this.adjustInTx(tx, storeId, skuId, input, user.sub),
    );
  }

  /** 门店小程序：负责人调整本店库存与安全库存 */
  async adjustForStore(storeId: string, skuId: string, input: StockAdjustInput, operatorId: string) {
    return this.prisma.$transaction((tx) =>
      this.adjustInTx(tx, storeId, skuId, input, operatorId),
    );
  }

  async batchAdjust(user: AuthUser, storeId: string, items: Array<StockAdjustInput & { skuId: string }>) {
    await this.assertStore(user, storeId);
    if (!items.length) throw new BadRequestException('请选择需要调整的商品');
    if (items.length > 100) throw new BadRequestException('单次最多调整 100 个商品');

    const results = await this.prisma.$transaction(async (tx) => {
      const updated: Array<{ skuId: string; stock: number; available: number }> = [];
      for (const item of items) {
        const row = await this.adjustInTx(tx, storeId, item.skuId, item, user.sub);
        updated.push({ skuId: row.skuId, stock: row.stock, available: row.available });
      }
      return updated;
    });
    return { updated: results.length, items: results };
  }

  async logs(user: AuthUser, storeId: string, query: StockLogQuery) {
    await this.assertStore(user, storeId);

    const page = Math.max(Number(query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100);
    const where = {
      storeId,
      ...(query.skuId ? { skuId: query.skuId } : {}),
    };

    const [logs, total] = await this.prisma.$transaction([
      this.prisma.storeStockLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.storeStockLog.count({ where }),
    ]);

    const skuIds = [...new Set(logs.map((log) => log.skuId))];
    const skus = skuIds.length
      ? await this.prisma.sku.findMany({
          where: { id: { in: skuIds } },
          select: { id: true, code: true, product: { select: { title: true } } },
        })
      : [];
    const skuMap = new Map(skus.map((sku) => [sku.id, sku]));

    return {
      total,
      page,
      pageSize,
      items: logs.map((log) => ({
        id: log.id,
        skuId: log.skuId,
        skuCode: skuMap.get(log.skuId)?.code ?? '',
        title: skuMap.get(log.skuId)?.product.title ?? '',
        delta: log.delta,
        beforeStock: log.beforeStock,
        afterStock: log.afterStock,
        reason: log.reason,
        orderId: log.orderId,
        operatorId: log.operatorId,
        createdAt: log.createdAt,
      })),
    };
  }

  private async adjustInTx(
    tx: TxClient,
    storeId: string,
    skuId: string,
    input: StockAdjustInput,
    operatorId: string,
  ) {
    if (
      input.stock === undefined &&
      input.safetyStock === undefined &&
      input.status === undefined
    ) {
      throw new BadRequestException('请至少修改库存、安全库存或状态');
    }
    this.nonNegative(input.stock, '库存');
    this.nonNegative(input.safetyStock, '安全库存');

    const sku = await tx.sku.findUnique({ where: { id: skuId }, select: { id: true } });
    if (!sku) throw new NotFoundException('商品规格不存在');

    const existing = await tx.storeSku.findUnique({
      where: { storeId_skuId: { storeId, skuId } },
    });
    const beforeAvailable = existing ? Math.max(existing.stock - existing.reserved, 0) : 0;

    const nextStock = input.stock ?? existing?.stock ?? 0;
    if (existing && nextStock < existing.reserved) {
      throw new BadRequestException(`库存不能低于已预占数量 ${existing.reserved}`);
    }

    const row = existing
      ? await tx.storeSku.update({
          where: { storeId_skuId: { storeId, skuId } },
          data: {
            ...(input.stock !== undefined ? { stock: input.stock } : {}),
            ...(input.safetyStock !== undefined ? { safetyStock: input.safetyStock } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
          },
        })
      : await tx.storeSku.create({
          data: {
            storeId,
            skuId,
            stock: input.stock ?? 0,
            safetyStock: input.safetyStock ?? 0,
            status: input.status ?? 'ON_SALE',
          },
        });

    const afterAvailable = Math.max(row.stock - row.reserved, 0);
    await tx.storeStockLog.create({
      data: {
        storeId,
        skuId,
        delta: afterAvailable - beforeAvailable,
        beforeStock: beforeAvailable,
        afterStock: afterAvailable,
        reason: 'ADJUST',
        operatorId,
      },
    });

    return {
      skuId,
      stock: row.stock,
      reserved: row.reserved,
      available: afterAvailable,
      safetyStock: row.safetyStock,
      status: row.status,
    };
  }

  private async assertStore(user: AuthUser, storeId: string) {
    const scope = await this.scopes.resolve(user);
    this.scopes.assertAccess(scope, storeId);
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true },
    });
    if (!store) throw new NotFoundException('门店不存在');
  }

  private nonNegative(value: number | undefined, field: string): void {
    if (value === undefined) return;
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${field}必须为非负整数`);
    }
  }
}
