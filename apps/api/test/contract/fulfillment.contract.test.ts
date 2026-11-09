/**
 * 迭代 B 契约测试：批量发货、物流公司字典、首页运营位、评价晒图上传。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGREEMENT_VERSIONS } from '@shanye/shared';
import { PrismaClient } from '@prisma/client';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

/** 1x1 PNG，用于评价晒图上传 */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

let prisma: PrismaClient | null = null;
let userToken = '';
let superToken = '';
let orderId = '';
let skuId = '';

async function api(path: string, init: RequestInit = {}, token = '') {
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

  const admin = await api('/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account: 'admin@shanye.com', password: 'admin123' }),
  });
  superToken = admin.body.data.token;

  const sku = await prisma.sku.findFirst({ where: { status: 'ON_SALE' }, orderBy: { code: 'asc' } });
  const user = await prisma.user.findFirst({ where: { openid: 'dev_seed_user' } });
  skuId = sku?.id ?? '';
  if (!sku || !user) throw new Error('种子数据缺少 SKU 或用户');

  const order = await prisma.order.create({
    data: {
      orderNo: `CONTRACT${Date.now()}`,
      userId: user.id,
      status: 'PAID',
      goodsCents: 100,
      payableCents: 100,
      addressSnapshot: { receiver: '契约测试', phone: '13900000000', region: '云南省', detail: '测试路 1 号' },
      payDeadlineAt: new Date(Date.now() + 60_000),
      paidAt: new Date(),
      items: {
        create: {
          skuId: sku.id,
          title: sku.code ? `契约商品 ${sku.code}` : '契约商品',
          specText: '默认',
          priceCents: 100,
          quantity: 1,
          subtotalCents: 100,
          paidCents: 100,
        },
      },
    },
  });
  orderId = order.id;
});

afterAll(async () => {
  await prisma?.$disconnect();
  prisma = null;
});

describe('物流公司字典', () => {
  it('公开接口返回启用的物流公司', async () => {
    const result = await api('/express-companies');
    expect(result.status).toBe(200);
    expect(result.body.data.items.length).toBeGreaterThan(0);
    expect(result.body.data.items.some((item: { code: string }) => item.code === 'SF')).toBe(true);
  });

  it('后台可新增、停用并删除物流公司', async () => {
    const created = await api(
      '/admin/express-companies',
      {
        method: 'POST',
        body: JSON.stringify({ code: 'TESTX', name: '测试物流', sort: 99 }),
      },
      superToken,
    );
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const updated = await api(
      `/admin/express-companies/${id}`,
      { method: 'PATCH', body: JSON.stringify({ enabled: false }) },
      superToken,
    );
    expect(updated.status).toBe(200);

    const removed = await api(`/admin/express-companies/${id}`, { method: 'DELETE' }, superToken);
    expect(removed.status).toBe(200);
  });
});

describe('批量发货', () => {
  it('逐单返回结果，成功后订单变为已发货', async () => {
    const result = await api(
      '/admin/orders/batch-ship',
      {
        method: 'POST',
        body: JSON.stringify({
          expressCode: 'SF',
          items: [
            { orderId, trackingNo: 'SF0000000001' },
            { orderNo: 'NOT-EXIST-ORDER', trackingNo: 'SF0000000002' },
          ],
        }),
      },
      superToken,
    );
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ total: 2, success: 1, failed: 1 });

    const order = await prisma?.order.findUnique({ where: { id: orderId }, include: { shipment: true } });
    expect(order?.status).toBe('SHIPPED');
    expect(order?.shipment?.trackingNo).toBe('SF0000000001');
  });
});

describe('首页运营位', () => {
  it('保存空配置后首页返回空运营位与兜底数据', async () => {
    const saved = await api(
      '/admin/home-layout',
      {
        method: 'PUT',
        body: JSON.stringify({ banners: [], navs: [], sections: [] }),
      },
      superToken,
    );
    expect(saved.status).toBe(200);

    const home = await api('/home');
    expect(home.status).toBe(200);
    expect(home.body.data.banners).toEqual([]);
    expect(Array.isArray(home.body.data.picks)).toBe(true);
  });

  it('推荐位包含下架商品时保存失败', async () => {
    const result = await api(
      '/admin/home-layout',
      {
        method: 'PUT',
        body: JSON.stringify({
          banners: [],
          navs: [],
          sections: [{ title: '测试推荐', productIds: ['not-exist-product'], sort: 0, enabled: true }],
        }),
      },
      superToken,
    );
    expect(result.status).toBe(400);
  });

  it('保存推荐位后首页按配置返回商品', async () => {
    const product = await prisma?.product.findFirst({ where: { status: 'ON_SALE' } });
    const result = await api(
      '/admin/home-layout',
      {
        method: 'PUT',
        body: JSON.stringify({
          banners: [],
          navs: [],
          sections: [
            { title: '本周精选', productIds: [product?.id], sort: 0, enabled: true },
          ],
        }),
      },
      superToken,
    );
    expect(result.status).toBe(200);

    const home = await api('/home');
    expect(home.body.data.sections[0]).toMatchObject({ title: '本周精选' });
    expect(home.body.data.sections[0].products[0].id).toBe(product?.id);
  });
});

describe('评价晒图', () => {
  it('登录用户可上传评价图片并返回素材 key', async () => {
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(PNG_1PX)], { type: 'image/png' }), 'review.png');

    const res = await fetch(`${BASE}/reviews/images`, {
      method: 'POST',
      headers: { authorization: `Bearer ${userToken}` },
      body: form,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items[0].key).toMatch(/^\/api\/media\/assets\//);
    expect(skuId).toBeTruthy();
  });
});
