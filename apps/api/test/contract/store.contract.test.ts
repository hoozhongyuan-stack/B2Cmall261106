/**
 * 迭代 A 契约测试：门店 CRUD、公开门店、门店账号数据范围与多门店绑定。
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

let prisma: PrismaClient | null = null;
let superToken = '';
let userToken = '';
let addressId = '';
let stockSkuId = '';
let stockSkuCode = '';

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

function storeBody(code: string, name = '契约门店') {
  return {
    code,
    name,
    phone: '13800001111',
    region: '云南省昆明市五华区',
    address: '测试路 1 号',
    pickupEnabled: true,
    deliveryEnabled: true,
    deliveryFeeCents: 500,
    freeDeliveryThresholdCents: 9900,
    deliverySlots: ['10:00-12:00', '14:00-18:00'],
    deliveryCutoff: '18:00',
    maxOrdersPerSlot: 20,
    pickupCompleteDays: 7,
    deliveryRegions: ['云南省昆明市五华区'],
  };
}

function uniqueCode(prefix: string): string {
  return `${prefix}${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
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

  const addresses = await api('/addresses', {}, userToken);
  addressId = addresses.body.data.items[0]?.id ?? '';
  if (!addressId) {
    const created = await api(
      '/addresses',
      {
        method: 'POST',
        body: JSON.stringify({
          receiver: '门店库存测试',
          phone: '13900002222',
          region: '云南省昆明市五华区',
          detail: '库存路 1 号',
          isDefault: true,
        }),
      },
      userToken,
    );
    addressId = created.body.data.id;
  }

  const sku = await prisma.sku.findFirst({
    where: { status: 'ON_SALE' },
    orderBy: { code: 'asc' },
  });
  stockSkuId = sku?.id ?? '';
  stockSkuCode = sku?.code ?? '';
});

afterAll(async () => {
  await prisma?.$disconnect();
  prisma = null;
});

describe('门店契约', () => {
  it('创建 / 列表 / 详情 / 修改 / 停用', async () => {
    const code = uniqueCode('ST');
    const created = await api(
      '/admin/stores',
      { method: 'POST', body: JSON.stringify(storeBody(code)) },
      superToken,
    );
    expect(created.status).toBe(201);
    const store = created.body.data;
    expect(store.code).toBe(code);
    expect(store.deliveryFeeCents).toBe(500);
    expect(store.deliveryRegions).toEqual(['云南省昆明市五华区']);

    const list = await api('/admin/stores', {}, superToken);
    expect(list.status).toBe(200);
    expect(list.body.data.items.some((item: { id: string }) => item.id === store.id)).toBe(true);

    const detail = await api(`/admin/stores/${store.id}`, {}, superToken);
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(store.id);

    const pub = await api('/stores?capability=PICKUP');
    expect(pub.status).toBe(200);
    expect(pub.body.data.items.some((item: { id: string }) => item.id === store.id)).toBe(true);

    const patched = await api(
      `/admin/stores/${store.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: '契约门店改',
          deliveryFeeCents: 800,
          deliveryRegions: ['云南省昆明市盘龙区'],
        }),
      },
      superToken,
    );
    expect(patched.status).toBe(200);
    expect(patched.body.data.name).toBe('契约门店改');
    expect(patched.body.data.deliveryFeeCents).toBe(800);
    expect(patched.body.data.deliveryRegions).toEqual(['云南省昆明市盘龙区']);

    const removed = await api(`/admin/stores/${store.id}`, { method: 'DELETE' }, superToken);
    expect(removed.status).toBe(200);

    const pubAfter = await api('/stores');
    expect(pubAfter.body.data.items.some((item: { id: string }) => item.id === store.id)).toBe(
      false,
    );
  });

  it('配送时段或截单时间格式错误返回 400', async () => {
    const badSlot = await api(
      '/admin/stores',
      {
        method: 'POST',
        body: JSON.stringify({ ...storeBody(uniqueCode('BS')), deliverySlots: ['10:00'] }),
      },
      superToken,
    );
    expect(badSlot.status).toBe(400);

    const badCutoff = await api(
      '/admin/stores',
      {
        method: 'POST',
        body: JSON.stringify({ ...storeBody(uniqueCode('BC')), deliveryCutoff: '25:00' }),
      },
      superToken,
    );
    expect(badCutoff.status).toBe(400);
  });
});

describe('门店账号数据范围', () => {
  it('只返回授权门店，越权访问 404，不能新建门店', async () => {
    const first = await api(
      '/admin/stores',
      { method: 'POST', body: JSON.stringify(storeBody(uniqueCode('A'))) },
      superToken,
    );
    const second = await api(
      '/admin/stores',
      { method: 'POST', body: JSON.stringify(storeBody(uniqueCode('B'))) },
      superToken,
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const account = `store-${Date.now()}@shanye.com`;
    const password = 'store12345';
    const created = await api(
      '/admin/accounts',
      {
        method: 'POST',
        body: JSON.stringify({
          account,
          displayName: '契约门店账号',
          role: 'STORE',
          password,
          storeIds: [first.body.data.id],
        }),
      },
      superToken,
    );
    expect(created.status).toBe(201);
    expect(created.body.data.storeIds).toEqual([first.body.data.id]);

    const login = await api('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ account, password }),
    });
    expect(login.status).toBe(200);
    const storeToken = login.body.data.token;

    const mine = await api('/admin/stores/mine', {}, storeToken);
    expect(mine.status).toBe(200);
    expect(mine.body.data.items.map((item: { id: string }) => item.id)).toEqual([
      first.body.data.id,
    ]);

    const list = await api('/admin/stores', {}, storeToken);
    expect(list.body.data.items.map((item: { id: string }) => item.id)).toEqual([
      first.body.data.id,
    ]);

    const denied = await api(`/admin/stores/${second.body.data.id}`, {}, storeToken);
    expect(denied.status).toBe(404);

    const createDenied = await api(
      '/admin/stores',
      { method: 'POST', body: JSON.stringify(storeBody(uniqueCode('C'))) },
      storeToken,
    );
    expect(createDenied.status).toBe(403);
  });

  it('非门店账号绑定门店返回 400', async () => {
    const store = await api(
      '/admin/stores',
      { method: 'POST', body: JSON.stringify(storeBody(uniqueCode('D'))) },
      superToken,
    );
    const created = await api(
      '/admin/accounts',
      {
        method: 'POST',
        body: JSON.stringify({
          account: `ops-${Date.now()}@shanye.com`,
          displayName: '非门店账号',
          role: 'OPS',
          password: 'ops123456',
          storeIds: [store.body.data.id],
        }),
      },
      superToken,
    );
    expect(created.status).toBe(400);
  });
});

describe('门店库存与订单来源', () => {
  it('50 并发抢 10 件不超卖，取消释放、支付扣减、退款回补', async () => {
    // 50 个事务在门店库存行上排队，CI 上留足超时余量
    expect(addressId).toBeTruthy();
    expect(stockSkuId).toBeTruthy();

    const storeRes = await api(
      '/admin/stores',
      { method: 'POST', body: JSON.stringify(storeBody(uniqueCode('S'))) },
      superToken,
    );
    expect(storeRes.status).toBe(201);
    const storeId = storeRes.body.data.id;

    const batch = await api(
      `/admin/stores/${storeId}/skus/batch`,
      { method: 'POST', body: JSON.stringify({ items: [{ skuId: stockSkuId, stock: 10 }] }) },
      superToken,
    );
    expect(batch.status).toBe(201);
    expect(batch.body.data.updated).toBe(1);

    const listed = await api(
      `/admin/stores/${storeId}/skus?skuIds=${stockSkuId}`,
      {},
      superToken,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.data.items[0].available).toBe(10);

    const options = await api(
      `/admin/stores/${storeId}/sku-options?keyword=${encodeURIComponent(stockSkuCode)}`,
      {},
      superToken,
    );
    expect(options.status).toBe(200);
    expect(
      options.body.data.items.some(
        (item: { skuId: string; configured: boolean }) =>
          item.skuId === stockSkuId && item.configured,
      ),
    ).toBe(true);

    const attempts = await Promise.all(
      Array.from({ length: 50 }, () =>
        api(
          '/orders',
          {
            method: 'POST',
            headers: { 'idempotency-key': randomUUID() },
            body: JSON.stringify({
              addressId,
              items: [{ skuId: stockSkuId, quantity: 1 }],
              fulfillmentType: 'PICKUP',
              storeId,
            }),
          },
          userToken,
        ),
      ),
    );
    const success = attempts.filter((item) => item.status === 201);
    expect(
      success,
      JSON.stringify(attempts.filter((item) => item.status !== 201).slice(0, 2).map((item) => item.body)),
    ).toHaveLength(10);

    const afterConcurrent = await prisma!.storeSku.findUnique({
      where: { storeId_skuId: { storeId, skuId: stockSkuId } },
    });
    expect(afterConcurrent?.stock).toBe(10);
    expect(afterConcurrent?.reserved).toBe(10);

    const cancelled = await api(
      `/orders/${success[0].body.data.id}/cancel`,
      { method: 'POST' },
      userToken,
    );
    expect(cancelled.status).toBe(200);
    const afterCancel = await prisma!.storeSku.findUnique({
      where: { storeId_skuId: { storeId, skuId: stockSkuId } },
    });
    expect(afterCancel?.reserved).toBe(9);

    const belowReserved = await api(
      `/admin/stores/${storeId}/skus/${stockSkuId}`,
      { method: 'PATCH', body: JSON.stringify({ stock: 5 }) },
      superToken,
    );
    expect(belowReserved.status).toBe(400);

    const paidOrderId = success[1].body.data.id;
    const pay = await api(`/orders/${paidOrderId}/pay`, { method: 'POST' }, userToken);
    expect(pay.status).toBe(200);
    const confirmed = await api(
      '/payments/mock/confirm',
      { method: 'POST', body: JSON.stringify({ outTradeNo: pay.body.data.outTradeNo }) },
      userToken,
    );
    expect(confirmed.status).toBe(200);

    const afterPay = await prisma!.storeSku.findUnique({
      where: { storeId_skuId: { storeId, skuId: stockSkuId } },
    });
    expect(afterPay?.stock).toBe(9);
    expect(afterPay?.reserved).toBe(8);

    const detail = await api(`/orders/${paidOrderId}`, {}, userToken);
    expect(detail.body.data.status).toBe('PAID');
    expect(detail.body.data.fulfillmentType).toBe('PICKUP');
    expect(detail.body.data.storeId).toBe(storeId);
    const orderItemId = detail.body.data.items[0].id;

    const applied = await api(
      '/after-sales',
      {
        method: 'POST',
        body: JSON.stringify({ orderItemId, type: 'REFUND_ONLY', reason: '门店退款测试' }),
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

    const afterRefund = await prisma!.storeSku.findUnique({
      where: { storeId_skuId: { storeId, skuId: stockSkuId } },
    });
    expect(afterRefund?.stock).toBe(10);
    expect(afterRefund?.reserved).toBe(8);

    const logs = await api(
      `/admin/stores/${storeId}/stock-logs?skuId=${stockSkuId}`,
      {},
      superToken,
    );
    const reasons = new Set(logs.body.data.items.map((item: { reason: string }) => item.reason));
    expect(reasons.has('ORDER_RESERVE')).toBe(true);
    expect(reasons.has('ORDER_RELEASE')).toBe(true);
    expect(reasons.has('ORDER_PAID')).toBe(true);
    expect(reasons.has('REFUND')).toBe(true);
  }, 120_000);
});

describe('订单归属与后台筛选', () => {
  it('总部按门店/履约方式筛选，门店账号只看授权门店订单', async () => {
    const createStoreWithStock = async (prefix: string) => {
      const store = await api(
        '/admin/stores',
        { method: 'POST', body: JSON.stringify(storeBody(uniqueCode(prefix))) },
        superToken,
      );
      expect(store.status).toBe(201);
      const stock = await api(
        `/admin/stores/${store.body.data.id}/skus/batch`,
        { method: 'POST', body: JSON.stringify({ items: [{ skuId: stockSkuId, stock: 3 }] }) },
        superToken,
      );
      expect(stock.status).toBe(201);
      return store.body.data.id as string;
    };

    const createPickupOrder = async (storeId: string) => {
      const created = await api(
        '/orders',
        {
          method: 'POST',
          headers: { 'idempotency-key': randomUUID() },
          body: JSON.stringify({
            addressId,
            items: [{ skuId: stockSkuId, quantity: 1 }],
            fulfillmentType: 'PICKUP',
            storeId,
          }),
        },
        userToken,
      );
      expect(created.status).toBe(201);
      return created.body.data.id as string;
    };

    const firstStoreId = await createStoreWithStock('F');
    const secondStoreId = await createStoreWithStock('G');
    const firstOrderId = await createPickupOrder(firstStoreId);
    const secondOrderId = await createPickupOrder(secondStoreId);

    const hqFiltered = await api(
      `/admin/orders?storeId=${firstStoreId}&fulfillmentType=PICKUP&pageSize=100`,
      {},
      superToken,
    );
    expect(hqFiltered.status).toBe(200);
    const hqIds = hqFiltered.body.data.items.map((item: { id: string }) => item.id);
    expect(hqIds).toContain(firstOrderId);
    expect(hqIds).not.toContain(secondOrderId);

    const hqExpress = await api('/admin/orders?fulfillmentType=EXPRESS&pageSize=100', {}, superToken);
    expect(
      hqExpress.body.data.items.map((item: { id: string }) => item.id),
    ).not.toContain(firstOrderId);

    const account = `order-store-${Date.now()}@shanye.com`;
    const password = 'store12345';
    const createdAccount = await api(
      '/admin/accounts',
      {
        method: 'POST',
        body: JSON.stringify({
          account,
          displayName: '订单门店账号',
          role: 'STORE',
          password,
          storeIds: [firstStoreId],
        }),
      },
      superToken,
    );
    expect(createdAccount.status).toBe(201);
    const login = await api('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ account, password }),
    });
    const storeToken = login.body.data.token;

    const scopedList = await api('/admin/orders?pageSize=100', {}, storeToken);
    expect(scopedList.status).toBe(200);
    expect(
      scopedList.body.data.items.every(
        (item: { storeId: string }) => item.storeId === firstStoreId,
      ),
    ).toBe(true);
    expect(scopedList.body.data.items.map((item: { id: string }) => item.id)).toContain(
      firstOrderId,
    );
    expect(scopedList.body.data.items.map((item: { id: string }) => item.id)).not.toContain(
      secondOrderId,
    );

    const ownDetail = await api(`/admin/orders/${firstOrderId}`, {}, storeToken);
    expect(ownDetail.status).toBe(200);
    expect(ownDetail.body.data.store.name).toBeTruthy();

    const crossDetail = await api(`/admin/orders/${secondOrderId}`, {}, storeToken);
    expect(crossDetail.status).toBe(404);

    const crossFilter = await api(`/admin/orders?storeId=${secondStoreId}`, {}, storeToken);
    expect(crossFilter.status).toBe(404);
  }, 60_000);
});

describe('门店看板', () => {
  it('今日经营、待履约、库存预警与门店数据范围', async () => {
    const store = await api(
      '/admin/stores',
      { method: 'POST', body: JSON.stringify(storeBody(uniqueCode('H'))) },
      superToken,
    );
    const storeId = store.body.data.id as string;

    const stock = await api(
      `/admin/stores/${storeId}/skus/batch`,
      {
        method: 'POST',
        body: JSON.stringify({ items: [{ skuId: stockSkuId, stock: 5, safetyStock: 5 }] }),
      },
      superToken,
    );
    expect(stock.status).toBe(201);

    const order = await api(
      '/orders',
      {
        method: 'POST',
        headers: { 'idempotency-key': randomUUID() },
        body: JSON.stringify({
          addressId,
          items: [{ skuId: stockSkuId, quantity: 1 }],
          fulfillmentType: 'PICKUP',
          storeId,
        }),
      },
      userToken,
    );
    expect(order.status).toBe(201);
    const pay = await api(`/orders/${order.body.data.id}/pay`, { method: 'POST' }, userToken);
    await api(
      '/payments/mock/confirm',
      { method: 'POST', body: JSON.stringify({ outTradeNo: pay.body.data.outTradeNo }) },
      userToken,
    );

    const dashboard = await api(`/admin/stores/${storeId}/dashboard`, {}, superToken);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.today.paidOrders).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.data.today.gmvCents).toBeGreaterThan(0);
    expect(dashboard.body.data.pending.pickupOrders).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.data.stock.warningCount).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.data.stock.warnings[0].available).toBeLessThanOrEqual(5);

    const account = `dashboard-store-${Date.now()}@shanye.com`;
    const password = 'store12345';
    await api(
      '/admin/accounts',
      {
        method: 'POST',
        body: JSON.stringify({
          account,
          displayName: '看板门店账号',
          role: 'STORE',
          password,
          storeIds: [storeId],
        }),
      },
      superToken,
    );
    const login = await api('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ account, password }),
    });
    const storeToken = login.body.data.token;

    const own = await api(`/admin/stores/${storeId}/dashboard`, {}, storeToken);
    expect(own.status).toBe(200);

    const another = await api(
      '/admin/stores',
      { method: 'POST', body: JSON.stringify(storeBody(uniqueCode('J'))) },
      superToken,
    );
    const cross = await api(
      `/admin/stores/${another.body.data.id}/dashboard`,
      {},
      storeToken,
    );
    expect(cross.status).toBe(404);
  }, 60_000);
});
