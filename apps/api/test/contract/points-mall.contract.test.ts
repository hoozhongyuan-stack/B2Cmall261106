/**
 * 积分商城契约测试：后台配置积分商品、正常渠道隔离、纯积分兑换、限兑与整单退款。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGREEMENT_VERSIONS } from '@shanye/shared';
import { PrismaClient } from '@prisma/client';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

let prisma: PrismaClient | null = null;
let userToken = '';
let adminToken = '';
let userId = '';
let productId = '';
let skuId = '';
let addressId = '';
let orderId = '';

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
    body: JSON.stringify({
      code: 'seed_user',
      agreed: true,
      agreementVersion: AGREEMENT_VERSIONS.terms,
      privacyVersion: AGREEMENT_VERSIONS.privacy,
    }),
  });
  userToken = login.body.data.token;

  const admin = await api(
    '/admin/auth/login',
    { method: 'POST', body: JSON.stringify({ account: 'admin@shanye.com', password: 'admin123' }) },
    '',
  );
  adminToken = admin.body.data.token;

  const user = await prisma.user.findUnique({ where: { openid: 'dev_seed_user' } });
  const address = await prisma.address.findFirst({ where: { userId: user!.id } });
  const category = await prisma.category.findFirst();
  if (!user || !address || !category) throw new Error('种子数据缺少用户、地址或分类');
  userId = user.id;
  addressId = address.id;
  await prisma.user.update({ where: { id: userId }, data: { points: { set: 5000 } } });

  const created = await api(
    '/admin/products',
    {
      method: 'POST',
      body: JSON.stringify({
        title: `契约积分商品${Date.now()}`,
        categoryId: category.id,
        channel: 'POINTS',
        pointsLimitPerUser: 1,
        status: 'ON_SALE',
        skus: [
          {
            specJson: { 规格: '默认' },
            priceCents: 0,
            pointsCost: 100,
            pointsMoneyCents: 0,
            stock: 5,
          },
        ],
      }),
    },
    adminToken,
  );
  expect(created.status).toBe(201);
  productId = created.body.data.id;
  skuId = created.body.data.skus[0].id;
});

afterAll(async () => {
  await prisma?.$disconnect();
  prisma = null;
});

describe('积分商城', () => {
  it('积分商品出现在积分商城，不出现在普通商品列表', async () => {
    const mall = await api('/points-mall/products', {}, '');
    expect(mall.status).toBe(200);
    const item = mall.body.data.items.find((row: { id: string }) => row.id === productId);
    expect(item).toBeTruthy();
    expect(item.pointsCostMin).toBe(100);

    const normal = await api('/products?keyword=' + encodeURIComponent('契约积分商品'), {}, '');
    expect(normal.status).toBe(200);
    expect(normal.body.data.items.some((row: { id: string }) => row.id === productId)).toBe(false);
  });

  it('普通购物车拒绝积分商品', async () => {
    const res = await api(
      '/cart/items',
      { method: 'POST', body: JSON.stringify({ skuId, quantity: 1 }) },
      userToken,
    );
    expect([400, 404, 409]).toContain(res.status);
  });

  it('纯积分兑换直接完成并扣减积分与库存', async () => {
    const before = await prisma!.user.findUniqueOrThrow({ where: { id: userId } });
    const res = await api(
      '/member/points-mall/orders',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': `points-${Date.now()}` },
        body: JSON.stringify({ skuId, quantity: 1, addressId }),
      },
      userToken,
    );
    expect(res.status).toBe(201);
    orderId = res.body.data.orderId;
    expect(res.body.data.pointsUsed).toBe(100);
    expect(res.body.data.payableCents).toBe(0);
    expect(res.body.data.status).toBe('PAID');

    const order = await api(`/orders/${orderId}`, {}, userToken);
    expect(order.status).toBe(200);
    expect(order.body.data.orderType).toBe('POINTS');
    expect(order.body.data.items[0].pointsCost).toBe(100);

    const after = await prisma!.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.points).toBe(before.points - 100);

    const ledger = await api('/member/points');
    expect(
      ledger.body.data.items.some(
        (row: { source: string; orderId: string }) =>
          row.source === 'EXCHANGE' && row.orderId === orderId,
      ),
    ).toBe(true);
  });

  it('超过每人限兑返回 409', async () => {
    const res = await api(
      '/member/points-mall/orders',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': `points-limit-${Date.now()}` },
        body: JSON.stringify({ skuId, quantity: 1, addressId }),
      },
      userToken,
    );
    expect(res.status).toBe(409);
  });

  it('后台整单退款返还积分并回补库存', async () => {
    const before = await prisma!.user.findUniqueOrThrow({ where: { id: userId } });
    const res = await api(`/admin/points-mall/orders/${orderId}/refund`, { method: 'POST' }, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.pointsRefunded).toBe(100);

    const after = await prisma!.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.points).toBe(before.points + 100);

    const order = await api(`/orders/${orderId}`, {}, userToken);
    expect(order.body.data.status).toBe('REFUNDED');

    const ledger = await api('/member/points');
    expect(
      ledger.body.data.items.some(
        (row: { source: string; orderId: string }) =>
          row.source === 'EXCHANGE_REFUND' && row.orderId === orderId,
      ),
    ).toBe(true);

    const quota = await prisma!.pointsMallQuota.findUnique({
      where: { userId_productId: { userId, productId } },
    });
    expect(quota?.usedQty ?? 0).toBe(0);
  });
});
