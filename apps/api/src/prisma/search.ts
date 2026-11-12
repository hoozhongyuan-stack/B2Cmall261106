import { Prisma } from '@prisma/client';

import type { PrismaService } from './prisma.module';

export type ProductSort = 'default' | 'sales' | 'price_asc' | 'price_desc' | 'new';

export interface ProductSearchParams {
  keyword?: string;
  categoryId?: string;
  priceMinCents?: number;
  priceMaxCents?: number;
  tagId?: string;
  storeId?: string;
  sort?: ProductSort;
  page?: number;
  pageSize?: number;
}

export interface ProductSearchRow {
  id: string;
  title: string;
  subtitle: string | null;
  mainImageKey: string | null;
  priceMinCents: number;
  priceMaxCents: number;
  soldCount: number;
  status: string;
}

export interface ProductSearchResult {
  total: number;
  items: ProductSearchRow[];
}

/** LIKE 通配符转义，避免用户输入 % / _ 被当成通配符 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * 关键词召回：
 * - 多字符：ILIKE 保证中文短词召回，`%` / `<%` 提供 trigram 模糊容错，三者共用 GIN 索引
 * - 单字符：pg_trgm 至少两个字符才能命中索引，降级为 ILIKE，匹配串首或任意词首
 */
export function keywordCondition(keyword: string): Prisma.Sql {
  if (keyword.length === 1) {
    const escaped = escapeLike(keyword);
    return Prisma.sql`(p."searchText" ILIKE ${`${escaped}%`} OR p."searchText" ILIKE ${`% ${escaped}%`})`;
  }
  return Prisma.sql`(p."searchText" ILIKE ${`%${escapeLike(keyword)}%`} OR p."searchText" % ${keyword} OR p."searchText" <% ${keyword})`;
}

function buildWhere(keyword: string | undefined, params: ProductSearchParams): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`p."status" = 'ON_SALE'`,
    // 积分商品只在积分商城展示，普通列表/搜索/分类/选品全部排除
    Prisma.sql`p."channel" = 'NORMAL'`,
  ];

  if (keyword) conditions.push(keywordCondition(keyword));
  if (params.categoryId) conditions.push(Prisma.sql`p."categoryId" = ${params.categoryId}`);
  // 价格区间按商品价格带与筛选区间重叠计算
  if (params.priceMinCents !== undefined) {
    conditions.push(Prisma.sql`p."priceMaxCents" >= ${params.priceMinCents}`);
  }
  if (params.priceMaxCents !== undefined) {
    conditions.push(Prisma.sql`p."priceMinCents" <= ${params.priceMaxCents}`);
  }
  if (params.tagId) {
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "ProductTag" t WHERE t."productId" = p.id AND t.id = ${params.tagId})`,
    );
  }
  if (params.storeId) {
    conditions.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM "StoreSku" ss JOIN "Sku" s ON s.id = ss."skuId"
        WHERE s."productId" = p.id AND ss."storeId" = ${params.storeId}
          AND ss."status" = 'ON_SALE' AND ss.stock - ss.reserved > 0
      )`,
    );
  }

  return Prisma.join(conditions, ' AND ');
}

export function buildOrderBy(sort: ProductSort, keyword: string | undefined): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  const relevance = Prisma.sql`similarity(p."searchText", ${keyword ?? ''}) DESC`;

  switch (sort) {
    case 'sales':
      parts.push(Prisma.sql`p."soldCount" DESC`);
      if (keyword) parts.push(relevance);
      break;
    case 'price_asc':
      parts.push(Prisma.sql`p."priceMinCents" ASC`);
      break;
    case 'price_desc':
      parts.push(Prisma.sql`p."priceMinCents" DESC`);
      break;
    case 'new':
      parts.push(Prisma.sql`p."createdAt" DESC`);
      break;
    default:
      if (keyword) {
        parts.push(relevance);
        parts.push(Prisma.sql`p."soldCount" DESC`);
      }
      parts.push(Prisma.sql`p."sort" ASC`);
  }

  // 稳定分页：所有排序都追加唯一键兜底
  parts.push(Prisma.sql`p."id" ASC`);
  return Prisma.join(parts, ', ');
}

/** 商品搜索：原生 SQL 集中在本层，业务层只做参数校验与结果拼装 */
export async function searchProducts(
  prisma: PrismaService,
  params: ProductSearchParams,
): Promise<ProductSearchResult> {
  const keyword = params.keyword?.trim();
  const page = Math.max(params.page ?? 1, 1);
  const pageSize = Math.min(Math.max(params.pageSize ?? 20, 1), 50);
  const where = buildWhere(keyword || undefined, params);
  const orderBy = buildOrderBy(params.sort ?? 'default', keyword || undefined);

  const [countRows, items] = await Promise.all([
    prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM "Product" p WHERE ${where}`,
    prisma.$queryRaw<ProductSearchRow[]>`
      SELECT p.id, p.title, p.subtitle, p."mainImageKey", p."priceMinCents", p."priceMaxCents",
             p."soldCount", p.status::text AS status
      FROM "Product" p
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
  ]);

  return { total: countRows[0]?.count ?? 0, items };
}
