import type { TxClient } from './prisma.module';

/** 下单行锁返回的 SKU 快照 */
export interface LockedSkuRow {
  id: string;
  stock: number;
  reserved: number;
  priceCents: number;
  pointsCost: number | null;
  pointsMoneyCents: number;
  status: string;
  code: string;
  specJson: unknown;
  productId: string;
  categoryId: string;
  channel: string;
  title: string;
  imageKey: string | null;
}

/** 原生查询集中在本层（工程契约 R4）：下单前锁定 SKU 行，串行化同 SKU 并发 */
export async function lockSkuForUpdate(tx: TxClient, id: string): Promise<LockedSkuRow | null> {
  const rows = await tx.$queryRaw<LockedSkuRow[]>`
    SELECT s.id, s.stock, s.reserved, s."priceCents", s."pointsCost", s."pointsMoneyCents", s.status,
           s.code, s."specJson", s."productId",
           p.title, p."mainImageKey" AS "imageKey", p."categoryId", p.channel::text AS channel
    FROM "Sku" s JOIN "Product" p ON p.id = s."productId"
    WHERE s.id = ${id}
    FOR UPDATE OF s`;
  return rows[0] ?? null;
}

/** 门店库存预占：单条 SQL 内比较可售库存，返回受影响行数 */
export async function reserveStoreSku(
  tx: TxClient,
  storeId: string,
  skuId: string,
  quantity: number,
): Promise<number> {
  return tx.$executeRaw`
    UPDATE "StoreSku" SET "reserved" = "reserved" + ${quantity}
    WHERE "storeId" = ${storeId} AND "skuId" = ${skuId}
      AND "status" = 'ON_SALE' AND "stock" - "reserved" >= ${quantity}`;
}

/** 领券原子扣减：单条 SQL 内比较 claimed < total，返回受影响行数 */
export async function incrementCouponClaimed(tx: TxClient, couponId: string): Promise<number> {
  return tx.$executeRaw`
    UPDATE "Coupon" SET "claimed" = "claimed" + 1
    WHERE "id" = ${couponId} AND "claimed" < "total"`;
}
