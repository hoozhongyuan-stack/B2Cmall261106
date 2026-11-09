/**
 * 迭代 D 契约测试：满减、限时秒杀、库存释放与经营看板。
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGREEMENT_VERSIONS } from '@shanye/shared';
import { PrismaClient } from '@prisma/client';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

let prisma: PrismaClient | null = null;
let userToken = '';
let superToken = '';
let addressId = '';
let skuId = '';
let skuPrice = 0;
let fullReductionId = '';
let seckillId = '';

async function api(path: string, init: RequestInit = {}, token = userToken) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });

  const login = await api('/auth/wechat-login', {
    method: 'POST',
    body: JSON.stringify({ code: 'seed_user', agreed: true, agreementVersion: AGREEMENT_VERSIONS.terms, privacyVersion: AGREEMENT_VERSIONS.privacy }),
  });
  userToken = login.body.data.token;

  const admin = await api(
    '/admin/auth/login',
    { method: 'POST', body: JSON.stringify({ account: 'admin@shanye.com', password: 'admin123' }) },
    '',
  );
  superToken = admin.body.data.token;

  const address = await prisma.address.findFirst({ where: { user: { openid: 'dev_seed_user' } } });
  const sku = await prisma.sku.findFirst({
    where: { status: 'ON_SALE', stock: { gt: 5 }, priceCents: { gte: 12000 } },
    orderBy: { priceCents: 'desc' },
  });
  addressId = address?.id ?? '';
  skuId = sku?.id ?? '';
  skuPrice = sku?.priceCents ?? 0;
  if (!addressId || !skuId) throw new Error('种子数据缺少地址或高价位 SKU');
});

afterAll(async () => {
  if (prisma) {
    await prisma.promotion.deleteMany({ where: { id: { in: [fullReductionId, seckillId] } } });
    await prisma.$disconnect();
  }
  prisma = null;
});

describe('满减活动', () => {
  it('创建全场满减并在结算中自动命中', async () => {
    const created = await api(
      '/admin/promotions',
      {
        method: 'POST',
        body: JSON.stringify({
          name: '契约满减',
          type: 'FULL_REDUCTION',
          startAt: new Date(Date.now() - 60_000).toISOString(),
          endAt: new Date(Date.now() + 86_400_000).toISOString(),
          thresholdCents: 10000,
          discountCents: 1000,
          scopeType: 'ALL',
        }),
      },
      superToken,
    );
    expect(created.status).toBe(201);
    fullReductionId = created.body.data.id;

    const preview = await api(
      '/orders/preview',
      { method: 'POST', body: JSON.stringify({ items: [{ skuId, quantity: 1 }] }) },
      userToken,
    );
    expect(preview.status).toBe(200);
    expect(preview.body.data.fullReduction).toMatchObject({ name: '契约满减' });
    expect(preview.body.data.amount.fullReductionCents).toBe(1000);
  });

  it('满减金额大于门槛时创建失败', async () => {
    const result = await api(
      '/admin/promotions',
      {
        method: 'POST',
        body: JSON.stringify({
          name: '非法满减',
          type: 'FULL_REDUCTION',
          startAt: new Date().toISOString(),
          endAt: new Date(Date.now() + 86_400_000).toISOString(),
          thresholdCents: 1000,
          discountCents: 2000,
          scopeType: 'ALL',
        }),
      },
      superToken,
    );
    expect(result.status).toBe(400);
  });
});

describe('限时秒杀', () => {
  it('秒杀商品按秒杀价计算，不参与会员折扣与满减', async () => {
    const created = await api(
      '/admin/promotions',
      {
        method: 'POST',
        body: JSON.stringify({
          name: '契约秒杀',
          type: 'SECKILL',
          startAt: new Date(Date.now() - 60_000).toISOString(),
          endAt: new Date(Date.now() + 86_400_000).toISOString(),
          skus: [
            {
              skuId,
              seckillPriceCents: 1000,
              stock: 2,
              limitPerUser: 1,
            },
          ],
        }),
      },
      superToken,
    );
    expect(created.status).toBe(201);
    seckillId = created.body.data.id;

    const preview = await api(
      '/orders/preview',
      { method: 'POST', body: JSON.stringify({ items: [{ skuId, quantity: 1 }] }) },
      userToken,
    );
    expect(preview.status).toBe(200);
    expect(preview.body.data.items[0]).toMatchObject({ priceCents: 1000, isSeckill: true });
    expect(preview.body.data.amount.memberDiscountCents).toBe(0);
    expect(preview.body.data.amount.fullReductionCents).toBe(0);
  });

  it('秒杀库存与每人限购生效，取消订单释放秒杀库存', async () => {
    const first = await api(
      '/orders',
      {
        method: 'POST',
        headers: { 'idempotency-key': randomUUID() },
        body: JSON.stringify({ addressId, items: [{ skuId, quantity: 1 }] }),
      },
      userToken,
    );
    expect(first.status).toBe(201);

    const sold = await prisma?.seckillSku.findFirst({ where: { promotionId: seckillId } });
    expect(sold?.sold).toBe(1);

    const second = await api(
      '/orders',
      {
        method: 'POST',
        headers: { 'idempotency-key': randomUUID() },
        body: JSON.stringify({ addressId, items: [{ skuId, quantity: 1 }] }),
      },
      userToken,
    );
    expect(second.status).toBe(409);

    const canceled = await api(`/orders/${first.body.data.id}/cancel`, { method: 'POST' }, userToken);
    expect(canceled.status).toBe(200);
    const released = await prisma?.seckillSku.findFirst({ where: { promotionId: seckillId } });
    expect(released?.sold).toBe(0);
  });

  it('秒杀活动在公开接口可见', async () => {
    const list = await api('/promotions/seckill', {}, '');
    expect(list.status).toBe(200);
    expect(list.body.data.items.some((item: { promotionId: string }) => item.promotionId === seckillId)).toBe(true);
  });
});

describe('经营看板', () => {
  it('返回活动、会员、复购与商品排行结构', async () => {
    const overview = await api('/admin/analytics/overview?days=30', {}, superToken);
    expect(overview.status).toBe(200);
    expect(overview.body.data.overview).toHaveProperty('paidOrders');
    expect(overview.body.data.activity).toHaveProperty('seckillQuantity');
    expect(overview.body.data.member).toHaveProperty('rechargeCents');
    expect(overview.body.data.repurchase).toHaveProperty('repeatRate');
    expect(Array.isArray(overview.body.data.topProducts)).toBe(true);
    expect(skuPrice).toBeGreaterThan(0);
  });
});
