/**
 * 迭代 B 契约测试：自提下单、核销码生成、门店核销幂等、退款清码与过期拦截。
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

let prisma: PrismaClient | null = null;
let superToken = '';
let userToken = '';
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

function uniqueCode(prefix: string): string {
  return `${prefix}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 100)}`.slice(
    0,
    20,
  );
}

/** 默认营业时间 09:00-18:00，固定选 10:00-12:00 保证落在营业时间内 */
function futureSlot(): string {
  return '10:00-12:00';
}

async function createStore(): Promise<string> {
  const store = await api(
    '/admin/stores',
    {
      method: 'POST',
      body: JSON.stringify({
        code: uniqueCode('PK'),
        name: '自提契约门店',
        phone: '13800003333',
        region: '云南省昆明市五华区',
        address: '自提路 8 号',
        pickupEnabled: true,
        pickupCompleteDays: 7,
      }),
    },
    superToken,
  );
  expect(store.status).toBe(201);
  const storeId = store.body.data.id as string;

  const stock = await api(
    `/admin/stores/${storeId}/skus/batch`,
    { method: 'POST', body: JSON.stringify({ items: [{ skuId, stock: 20 }] }) },
    superToken,
  );
  expect(stock.status).toBe(201);
  return storeId;
}

async function createPaidPickupOrder(storeId: string): Promise<string> {
  const created = await api(
    '/orders',
    {
      method: 'POST',
      headers: { 'idempotency-key': randomUUID() },
      body: JSON.stringify({
        items: [{ skuId, quantity: 1 }],
        fulfillmentType: 'PICKUP',
        storeId,
        pickupSlot: futureSlot(),
        contactPhone: '13900004444',
      }),
    },
    userToken,
  );
  expect(created.status).toBe(201);
  expect(created.body.data.pickupCode).toBeNull();

  const pay = await api(`/orders/${created.body.data.id}/pay`, { method: 'POST' }, userToken);
  expect(pay.status).toBe(200);
  const confirmed = await api(
    '/payments/mock/confirm',
    { method: 'POST', body: JSON.stringify({ outTradeNo: pay.body.data.outTradeNo }) },
    userToken,
  );
  expect(confirmed.status).toBe(200);
  return created.body.data.id as string;
}

beforeAll(async () => {
  prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });

  const admin = await api('/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account: 'admin@shanye.com', password: 'admin123' }),
  });
  superToken = admin.body.data.token;

  const login = await api('/auth/wechat-login', {
    method: 'POST',
    body: JSON.stringify({ code: 'seed_user' }),
  });
  userToken = login.body.data.token;

  const sku = await prisma.sku.findFirst({
    where: { status: 'ON_SALE' },
    orderBy: { code: 'asc' },
  });
  skuId = sku?.id ?? '';
});

afterAll(async () => {
  await prisma?.$disconnect();
  prisma = null;
});

describe('自提下单', () => {
  it('自提免运费、返回门店信息、无需收货地址', async () => {
    expect(skuId).toBeTruthy();
    const storeId = await createStore();

    const preview = await api(
      '/orders/preview',
      {
        method: 'POST',
        body: JSON.stringify({
          items: [{ skuId, quantity: 1 }],
          fulfillmentType: 'PICKUP',
          storeId,
          pickupSlot: futureSlot(),
        }),
      },
      userToken,
    );
    expect(preview.status).toBe(200);
    expect(preview.body.data.fulfillmentType).toBe('PICKUP');
    expect(preview.body.data.amount.freightCents).toBe(0);
    expect(preview.body.data.pickup.store.id).toBe(storeId);
    expect(preview.body.data.pickup.slot).toBe(futureSlot());

    const badSlot = await api(
      '/orders/preview',
      {
        method: 'POST',
        body: JSON.stringify({
          items: [{ skuId, quantity: 1 }],
          fulfillmentType: 'PICKUP',
          storeId,
          pickupSlot: '23:00-23:30',
        }),
      },
      userToken,
    );
    expect(badSlot.status).toBe(400);
  });

  it('支付成功生成 8 位核销码与过期时间', async () => {
    const storeId = await createStore();
    const orderId = await createPaidPickupOrder(storeId);

    const detail = await api(`/orders/${orderId}`, {}, userToken);
    expect(detail.status).toBe(200);
    expect(detail.body.data.status).toBe('PAID');
    expect(detail.body.data.pickupCode).toMatch(/^\d{8}$/);
    expect(detail.body.data.pickupAt).toBeTruthy();
    expect(detail.body.data.pickupCodeExpiresAt).toBeTruthy();
    expect(detail.body.data.store.name).toBe('自提契约门店');
    expect(detail.body.data.address.phone).toBe('13900004444');
  });
});

describe('核销台', () => {
  it('待核销列表、跨店 404、核销成功与重复核销幂等', async () => {
    const storeA = await createStore();
    const storeB = await createStore();
    const orderId = await createPaidPickupOrder(storeA);

    const detail = await api(`/orders/${orderId}`, {}, userToken);
    const code = detail.body.data.pickupCode as string;

    const pending = await api(`/admin/pickups?status=pending&storeId=${storeA}`, {}, superToken);
    expect(pending.status).toBe(200);
    expect(
      pending.body.data.items.some((item: { id: string }) => item.id === orderId),
    ).toBe(true);

    const badFormat = await api(
      '/admin/pickups/verify',
      { method: 'POST', body: JSON.stringify({ code: '1234567' }) },
      superToken,
    );
    expect(badFormat.status).toBe(400);

    const notFound = await api(
      '/admin/pickups/verify',
      { method: 'POST', body: JSON.stringify({ code: '00000000' }) },
      superToken,
    );
    expect(notFound.status).toBe(404);

    // 门店账号只能核销授权门店：绑定 B 门店去核销 A 门店订单 → 404
    const account = `pickup-store-${Date.now()}@shanye.com`;
    const password = 'store12345';
    const createdAccount = await api(
      '/admin/accounts',
      {
        method: 'POST',
        body: JSON.stringify({
          account,
          displayName: '核销门店账号',
          role: 'STORE',
          password,
          storeIds: [storeB],
        }),
      },
      superToken,
    );
    expect(createdAccount.status).toBe(201);
    const storeLogin = await api('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ account, password }),
    });
    const storeToken = storeLogin.body.data.token;

    const cross = await api(
      '/admin/pickups/verify',
      { method: 'POST', body: JSON.stringify({ code }) },
      storeToken,
    );
    expect(cross.status).toBe(404);

    const verified = await api(
      '/admin/pickups/verify',
      { method: 'POST', body: JSON.stringify({ code }) },
      superToken,
    );
    expect(verified.status).toBe(200);
    expect(verified.body.data.alreadyVerified).toBe(false);
    expect(verified.body.data.order.status).toBe('COMPLETED');

    const again = await api(
      '/admin/pickups/verify',
      { method: 'POST', body: JSON.stringify({ code }) },
      superToken,
    );
    expect(again.status).toBe(200);
    expect(again.body.data.alreadyVerified).toBe(true);

    const detailAfter = await api(`/orders/${orderId}`, {}, userToken);
    expect(detailAfter.body.data.status).toBe('COMPLETED');
    expect(detailAfter.body.data.pickupVerification.method).toBe('CODE');

    const logs = await api(
      `/admin/logs?targetType=Order&keyword=${orderId}&pageSize=50`,
      {},
      superToken,
    );
    expect(logs.status).toBe(200);
    expect(
      logs.body.data.items.some(
        (item: { action: string; targetId: string }) =>
          item.action === 'PICKUP_VERIFY' && item.targetId === orderId,
      ),
    ).toBe(true);

    const records = await api(`/admin/pickups?status=verified&storeId=${storeA}`, {}, superToken);
    expect(records.status).toBe(200);
    expect(
      records.body.data.items.some((item: { orderId: string }) => item.orderId === orderId),
    ).toBe(true);
  }, 60_000);

  it('核销码过期后拒绝核销', async () => {
    const storeId = await createStore();
    const orderId = await createPaidPickupOrder(storeId);
    const detail = await api(`/orders/${orderId}`, {}, userToken);
    const code = detail.body.data.pickupCode as string;

    await prisma!.order.update({
      where: { id: orderId },
      data: { pickupCodeExpiresAt: new Date(Date.now() - 60_000) },
    });

    const expired = await api(
      '/admin/pickups/verify',
      { method: 'POST', body: JSON.stringify({ code }) },
      superToken,
    );
    expect(expired.status).toBe(400);
  }, 60_000);
});

describe('退款清码', () => {
  it('全额退款后核销码失效，订单不可再核销', async () => {
    const storeId = await createStore();
    const orderId = await createPaidPickupOrder(storeId);
    const detail = await api(`/orders/${orderId}`, {}, userToken);
    const code = detail.body.data.pickupCode as string;
    const orderItemId = detail.body.data.items[0].id as string;

    const applied = await api(
      '/after-sales',
      {
        method: 'POST',
        body: JSON.stringify({ orderItemId, type: 'REFUND_ONLY', reason: '自提退款测试' }),
      },
      userToken,
    );
    expect(applied.status).toBe(201);

    const approved = await api(
      `/admin/after-sales/${applied.body.data.id}/moderate`,
      { method: 'POST', body: JSON.stringify({ action: 'approve_only_refund' }) },
      superToken,
    );
    expect(approved.status).toBe(200);

    const after = await api(`/orders/${orderId}`, {}, userToken);
    expect(after.body.data.status).toBe('REFUNDED');
    expect(after.body.data.pickupCode).toBeNull();

    const verify = await api(
      '/admin/pickups/verify',
      { method: 'POST', body: JSON.stringify({ code }) },
      superToken,
    );
    expect(verify.status).toBe(404);
  }, 60_000);
});
