/**
 * 门店双端契约：门店关联会员、STORE 禁登 PC、小程序门店中心（工作台/核销/配送）。
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;
const PICKUP_SLOT = '10:00-12:00';
const DELIVERY_SLOT = '00:00-23:59';

let prisma: PrismaClient | null = null;
let superToken = '';
let buyerToken = '';
let addressId = '';
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

async function loginMember(code: string) {
  const res = await api('/auth/wechat-login', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  expect(res.status).toBe(200);
  return { token: res.body.data.token as string, userId: res.body.data.user.id as string };
}

async function createStore() {
  const res = await api(
    '/admin/stores',
    {
      method: 'POST',
      body: JSON.stringify({
        code: uniqueCode('SC'),
        name: `门店中心契约店 ${uniqueCode('N')}`,
        phone: '13800005555',
        region: '云南省昆明市五华区',
        address: '门店中心路 1 号',
        pickupEnabled: true,
        pickupCompleteDays: 7,
        deliveryEnabled: true,
        deliveryFeeCents: 500,
        freeDeliveryThresholdCents: 999900,
        deliverySlots: [DELIVERY_SLOT],
        deliveryCutoff: '23:58',
        maxOrdersPerSlot: 0,
        deliveryRegions: ['云南省昆明市五华区'],
      }),
    },
    superToken,
  );
  expect(res.status).toBe(201);
  const storeId = res.body.data.id as string;

  const stock = await api(
    `/admin/stores/${storeId}/skus/batch`,
    { method: 'POST', body: JSON.stringify({ items: [{ skuId, stock: 20 }] }) },
    superToken,
  );
  expect(stock.status).toBe(201);
  return storeId;
}

async function createPaidOrder(
  storeId: string,
  fulfillmentType: 'PICKUP' | 'DELIVERY',
): Promise<{ orderId: string; pickupCode: string | null }> {
  const body =
    fulfillmentType === 'PICKUP'
      ? {
          items: [{ skuId, quantity: 1 }],
          fulfillmentType,
          storeId,
          pickupSlot: PICKUP_SLOT,
          contactPhone: '13900006666',
        }
      : {
          items: [{ skuId, quantity: 1 }],
          fulfillmentType,
          storeId,
          deliverySlot: DELIVERY_SLOT,
          addressId,
        };

  const created = await api(
    '/orders',
    { method: 'POST', headers: { 'idempotency-key': randomUUID() }, body: JSON.stringify(body) },
    buyerToken,
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const orderId = created.body.data.id as string;

  const pay = await api(`/orders/${orderId}/pay`, { method: 'POST' }, buyerToken);
  expect(pay.status).toBe(200);
  const confirmed = await api(
    '/payments/mock/confirm',
    { method: 'POST', body: JSON.stringify({ outTradeNo: pay.body.data.outTradeNo }) },
    buyerToken,
  );
  expect(confirmed.status).toBe(200);

  const detail = await api(`/orders/${orderId}`, {}, buyerToken);
  return { orderId, pickupCode: detail.body.data.pickupCode ?? null };
}

beforeAll(async () => {
  prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });

  const admin = await api('/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account: 'admin@shanye.com', password: 'admin123' }),
  });
  superToken = admin.body.data.token;

  const buyer = await loginMember('seed_user');
  buyerToken = buyer.token;

  addressId = (await api('/addresses', {}, buyerToken)).body.data.items[0]?.id ?? '';
  if (!addressId) {
    const created = await api(
      '/addresses',
      {
        method: 'POST',
        body: JSON.stringify({
          receiver: '门店中心买家',
          phone: '13900007777',
          region: '云南省昆明市五华区',
          detail: '契约路 9 号',
          isDefault: true,
        }),
      },
      buyerToken,
    );
    addressId = created.body.data.id;
  }

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

describe('门店关联会员', () => {
  it('绑定后会员小程序可见门店中心，重复绑定其他门店返回 409，解绑后隐藏', async () => {
    const stamp = Date.now();
    const manager = await loginMember(`console-mgr-${stamp}`);
    await prisma!.user.update({
      where: { id: manager.userId },
      data: { phone: '13700008888' },
    });

    const storeA = await createStore();
    const storeB = await createStore();

    const bound = await api(
      `/admin/stores/${storeA}/manager`,
      { method: 'PUT', body: JSON.stringify({ managerUserId: manager.userId }) },
      superToken,
    );
    expect(bound.status).toBe(200);
    expect(bound.body.data.managerUserId).toBe(manager.userId);
    expect(bound.body.data.manager.phone).toBe('13700008888');

    const ctx = await api('/store-console/context', {}, manager.token);
    expect(ctx.status).toBe(200);
    expect(ctx.body.data.hasStore).toBe(true);
    expect(ctx.body.data.store.id).toBe(storeA);

    const dup = await api(
      `/admin/stores/${storeB}/manager`,
      { method: 'PUT', body: JSON.stringify({ managerUserId: manager.userId }) },
      superToken,
    );
    expect(dup.status).toBe(409);

    const noPhone = await loginMember(`console-nophone-${stamp}`);
    const rejected = await api(
      `/admin/stores/${storeB}/manager`,
      { method: 'PUT', body: JSON.stringify({ managerUserId: noPhone.userId }) },
      superToken,
    );
    expect(rejected.status).toBe(400);

    const guest = await api('/store-console/context', {}, buyerToken);
    expect(guest.body.data.hasStore).toBe(false);

    const unbound = await api(
      `/admin/stores/${storeA}/manager`,
      { method: 'PUT', body: JSON.stringify({ managerUserId: null }) },
      superToken,
    );
    expect(unbound.status).toBe(200);
    const after = await api('/store-console/context', {}, manager.token);
    expect(after.body.data.hasStore).toBe(false);
  }, 60_000);
});

describe('门店中心工作台与核销', () => {
  it('工作台返回待办与今日经营；只能核销本店自提码', async () => {
    const manager = await loginMember(`console-ops-${Date.now()}`);
    await prisma!.user.update({
      where: { id: manager.userId },
      data: { phone: '13700009999' },
    });

    const ownStore = await createStore();
    const otherStore = await createStore();
    await api(
      `/admin/stores/${ownStore}/manager`,
      { method: 'PUT', body: JSON.stringify({ managerUserId: manager.userId }) },
      superToken,
    );

    const own = await createPaidOrder(ownStore, 'PICKUP');
    const other = await createPaidOrder(otherStore, 'PICKUP');
    expect(own.pickupCode).toMatch(/^\d{8}$/);

    const summary = await api('/store-console/summary', {}, manager.token);
    expect(summary.status).toBe(200);
    expect(summary.body.data.store.id).toBe(ownStore);
    expect(summary.body.data.todo.pendingPickup).toBeGreaterThanOrEqual(1);
    expect(summary.body.data.today.paidOrders).toBeGreaterThanOrEqual(1);

    const cross = await api(
      '/store-console/pickups/verify',
      { method: 'POST', body: JSON.stringify({ code: other.pickupCode }) },
      manager.token,
    );
    expect(cross.status).toBe(404);

    const verified = await api(
      '/store-console/pickups/verify',
      { method: 'POST', body: JSON.stringify({ code: own.pickupCode }) },
      manager.token,
    );
    expect(verified.status).toBe(200);
    expect(verified.body.data.alreadyVerified).toBe(false);
    expect(verified.body.data.order.status).toBe('COMPLETED');

    const again = await api(
      '/store-console/pickups/verify',
      { method: 'POST', body: JSON.stringify({ code: own.pickupCode }) },
      manager.token,
    );
    expect(again.status).toBe(200);
    expect(again.body.data.alreadyVerified).toBe(true);

    const badFormat = await api(
      '/store-console/pickups/verify',
      { method: 'POST', body: JSON.stringify({ code: '123' }) },
      manager.token,
    );
    expect(badFormat.status).toBe(400);
  }, 90_000);

  it('非门店负责人访问工作台返回 404', async () => {
    const res = await api('/store-console/summary', {}, buyerToken);
    expect(res.status).toBe(404);
  });
});

describe('门店中心配送', () => {
  it('只看本店配送单，可接单与送达', async () => {
    const manager = await loginMember(`console-dlv-${Date.now()}`);
    await prisma!.user.update({
      where: { id: manager.userId },
      data: { phone: '13700001111' },
    });

    const ownStore = await createStore();
    const otherStore = await createStore();
    await api(
      `/admin/stores/${ownStore}/manager`,
      { method: 'PUT', body: JSON.stringify({ managerUserId: manager.userId }) },
      superToken,
    );

    const own = await createPaidOrder(ownStore, 'DELIVERY');
    const other = await createPaidOrder(otherStore, 'DELIVERY');

    const ownDelivery = await prisma!.delivery.findUnique({ where: { orderId: own.orderId } });
    const otherDelivery = await prisma!.delivery.findUnique({ where: { orderId: other.orderId } });
    expect(ownDelivery).toBeTruthy();
    expect(otherDelivery).toBeTruthy();

    const list = await api('/store-console/deliveries?status=PENDING&pageSize=100', {}, manager.token);
    expect(list.status).toBe(200);
    const ids = list.body.data.items.map((row: { id: string }) => row.id);
    expect(ids).toContain(ownDelivery!.id);
    expect(ids).not.toContain(otherDelivery!.id);

    const cross = await api(
      `/store-console/deliveries/${otherDelivery!.id}/accept`,
      { method: 'POST', body: JSON.stringify({}) },
      manager.token,
    );
    expect(cross.status).toBe(404);

    const accepted = await api(
      `/store-console/deliveries/${ownDelivery!.id}/accept`,
      { method: 'POST', body: JSON.stringify({ courierName: '门店自送' }) },
      manager.token,
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.delivery.status).toBe('ACCEPTED');

    const delivering = await api('/store-console/summary', {}, manager.token);
    expect(delivering.body.data.todo.delivering).toBeGreaterThanOrEqual(1);

    const delivered = await api(
      `/store-console/deliveries/${ownDelivery!.id}/deliver`,
      { method: 'POST' },
      manager.token,
    );
    expect(delivered.status).toBe(200);
    expect(delivered.body.data.delivery.status).toBe('DELIVERED');

    const order = await api(`/admin/orders/${own.orderId}`, {}, superToken);
    expect(order.body.data.status).toBe('COMPLETED');
  }, 90_000);
});

describe('门店中心库存与营业设置', () => {
  it('库存预警筛选、库存调整与营业设置保存', async () => {
    const manager = await loginMember(`console-stock-${Date.now()}`);
    await prisma!.user.update({
      where: { id: manager.userId },
      data: { phone: '13700002222' },
    });

    const storeId = await createStore();
    await api(
      `/admin/stores/${storeId}/manager`,
      { method: 'PUT', body: JSON.stringify({ managerUserId: manager.userId }) },
      superToken,
    );
    const stock = await api(
      `/admin/stores/${storeId}/skus/batch`,
      {
        method: 'POST',
        body: JSON.stringify({ items: [{ skuId, stock: 1, safetyStock: 5 }] }),
      },
      superToken,
    );
    expect(stock.status).toBe(201);

    // 可售 1 ≤ 安全库存 5 → 预警
    const list = await api('/store-console/stock?pageSize=100', {}, manager.token);
    expect(list.status).toBe(200);
    expect(list.body.data.warnings).toBeGreaterThanOrEqual(1);
    const row = list.body.data.items.find((item: { skuId: string }) => item.skuId === skuId);
    expect(row.warning).toBe(true);
    expect(row.available).toBe(1);

    const warned = await api('/store-console/stock?warning=1&pageSize=100', {}, manager.token);
    expect(warned.status).toBe(200);
    expect(warned.body.data.items.every((item: { warning: boolean }) => item.warning)).toBe(true);
    expect(warned.body.data.items.map((item: { skuId: string }) => item.skuId)).toContain(skuId);

    // 调整后预警解除
    const adjusted = await api(
      `/store-console/stock/${skuId}/adjust`,
      { method: 'POST', body: JSON.stringify({ stock: 30, safetyStock: 2 }) },
      manager.token,
    );
    expect(adjusted.status).toBe(200);
    expect(adjusted.body.data.stock).toBe(30);
    expect(adjusted.body.data.available).toBe(30);

    const after = await api('/store-console/stock?warning=1&pageSize=100', {}, manager.token);
    expect(after.body.data.items.map((item: { skuId: string }) => item.skuId)).not.toContain(skuId);

    // 负数库存被拒绝
    const invalid = await api(
      `/store-console/stock/${skuId}/adjust`,
      { method: 'POST', body: JSON.stringify({ stock: -1 }) },
      manager.token,
    );
    expect(invalid.status).toBe(400);

    // 营业设置：读取 → 修改 → 校验
    const settings = await api('/store-console/settings', {}, manager.token);
    expect(settings.status).toBe(200);
    expect(settings.body.data.id).toBe(storeId);
    expect(settings.body.data.pickupEnabled).toBe(true);

    const saved = await api(
      '/store-console/settings',
      {
        method: 'PATCH',
        body: JSON.stringify({
          notice: '今晚延长营业至 21:00',
          businessHours: {
            mon: [['10:00', '21:00']],
            tue: [],
            wed: [['10:00', '21:00']],
            thu: [['10:00', '21:00']],
            fri: [['10:00', '21:00']],
            sat: [['10:00', '21:00']],
            sun: [['10:00', '21:00']],
          },
          pickupEnabled: true,
          deliveryEnabled: false,
        }),
      },
      manager.token,
    );
    expect(saved.status).toBe(200);
    expect(saved.body.data.notice).toBe('今晚延长营业至 21:00');
    expect(saved.body.data.deliveryEnabled).toBe(false);
    expect(saved.body.data.businessHours.mon).toEqual([['10:00', '21:00']]);
    expect(saved.body.data.businessHours.tue).toEqual([]);

    const badHours = await api(
      '/store-console/settings',
      {
        method: 'PATCH',
        body: JSON.stringify({ businessHours: { mon: [['21:00', '10:00']] } }),
      },
      manager.token,
    );
    expect(badHours.status).toBe(400);

    // 非负责人不能读取或修改
    expect((await api('/store-console/stock', {}, buyerToken)).status).toBe(404);
    expect((await api('/store-console/settings', {}, buyerToken)).status).toBe(404);
  }, 90_000);
});

describe('门店中心临时打烊与看板', () => {
  it('打烊后不再接单，恢复营业后恢复；看板返回今日经营与时效', async () => {
    const manager = await loginMember(`console-close-${Date.now()}`);
    await prisma!.user.update({
      where: { id: manager.userId },
      data: { phone: '13700003333' },
    });

    const storeId = await createStore();
    await api(
      `/admin/stores/${storeId}/manager`,
      { method: 'PUT', body: JSON.stringify({ managerUserId: manager.userId }) },
      superToken,
    );

    // 正常营业时可下单
    const before = await createPaidOrder(storeId, 'PICKUP');
    expect(before.pickupCode).toMatch(/^\d{8}$/);

    // 看板：今日经营、待履约、配送时效与库存预警
    const dashboard = await api('/store-console/dashboard', {}, manager.token);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.store.id).toBe(storeId);
    expect(dashboard.body.data.today.paidOrders).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.data.pending.pickupOrders).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.data.delivery.overdueCount).toBeGreaterThanOrEqual(0);
    expect(dashboard.body.data.stock).toHaveProperty('warningCount');

    // 临时打烊 2 小时
    const until = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const closed = await api(
      '/store-console/closure',
      { method: 'POST', body: JSON.stringify({ until, note: '设备检修' }) },
      manager.token,
    );
    expect(closed.status).toBe(200);
    expect(closed.body.data.temporarilyClosed).toBe(true);
    expect(closed.body.data.temporaryClosureNote).toBe('设备检修');

    const ctx = await api('/store-console/context', {}, manager.token);
    expect(ctx.body.data.store.temporarilyClosedUntil).toBeTruthy();

    // 打烊期间新订单被拒绝
    const blocked = await api(
      '/orders',
      {
        method: 'POST',
        headers: { 'idempotency-key': randomUUID() },
        body: JSON.stringify({
          items: [{ skuId, quantity: 1 }],
          fulfillmentType: 'PICKUP',
          storeId,
          pickupSlot: PICKUP_SLOT,
          contactPhone: '13900006666',
        }),
      },
      buyerToken,
    );
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toContain('临时打烊');

    // 下单选店列表不再暴露该门店
    const publicList = await api('/stores?capability=PICKUP');
    expect(
      publicList.body.data.items.some((item: { id: string }) => item.id === storeId),
    ).toBe(false);

    // 过去的恢复时间被拒绝
    const past = await api(
      '/store-console/closure',
      { method: 'POST', body: JSON.stringify({ until: new Date(Date.now() - 60_000).toISOString() }) },
      manager.token,
    );
    expect(past.status).toBe(400);

    // 恢复营业后重新可下单
    const reopened = await api(
      '/store-console/closure',
      { method: 'POST', body: JSON.stringify({ until: null }) },
      manager.token,
    );
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.temporarilyClosed).toBe(false);
    expect(reopened.body.data.temporaryClosureNote).toBeNull();

    const after = await createPaidOrder(storeId, 'PICKUP');
    expect(after.pickupCode).toMatch(/^\d{8}$/);

    // 非负责人不能操作
    expect(
      (await api('/store-console/closure', { method: 'POST', body: JSON.stringify({ until: null }) }, buyerToken))
        .status,
    ).toBe(404);
    expect((await api('/store-console/dashboard', {}, buyerToken)).status).toBe(404);
  }, 90_000);
});
