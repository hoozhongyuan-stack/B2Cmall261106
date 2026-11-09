/**
 * 迭代 C 契约测试：配送范围与费用、时段容量、配送状态机、门店权限、取消与看板时效。
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGREEMENT_VERSIONS } from '@shanye/shared';
import { PrismaClient } from '@prisma/client';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

let prisma: PrismaClient | null = null;
let superToken = '';
let userToken = '';
let skuId = '';
let addressId = '';

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

const SLOT = '00:00-23:59';

async function createStore(options: { maxOrdersPerSlot?: number; storeCode?: string } = {}) {
  const res = await api(
    '/admin/stores',
    {
      method: 'POST',
      body: JSON.stringify({
        code: options.storeCode ?? uniqueCode('DL'),
        name: `配送门店 ${uniqueCode('N')}`,
        region: '云南省昆明市五华区',
        address: '契约配送路 1 号',
        deliveryEnabled: true,
        deliveryFeeCents: 800,
        freeDeliveryThresholdCents: 999900,
        deliverySlots: [SLOT],
        deliveryCutoff: '23:58',
        maxOrdersPerSlot: options.maxOrdersPerSlot ?? 0,
        deliveryRegions: ['云南省昆明市五华区'],
      }),
    },
    superToken,
  );
  expect(res.status).toBe(201);
  const store = res.body.data;
  const stock = await api(
    `/admin/stores/${store.id}/skus/batch`,
    { method: 'POST', body: JSON.stringify({ items: [{ skuId, stock: 20 }] }) },
    superToken,
  );
  expect(stock.status).toBe(201);
  return store;
}

function deliveryBody(storeId: string) {
  return {
    items: [{ skuId, quantity: 1 }],
    fulfillmentType: 'DELIVERY',
    storeId,
    deliverySlot: SLOT,
    addressId,
  };
}

async function createPaidDelivery(storeId: string): Promise<{ orderId: string; deliveryId: string }> {
  const created = await api(
    '/orders',
    {
      method: 'POST',
      headers: { 'idempotency-key': randomUUID() },
      body: JSON.stringify(deliveryBody(storeId)),
    },
    userToken,
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const orderId = created.body.data.id as string;

  const pay = await api(`/orders/${orderId}/pay`, { method: 'POST' }, userToken);
  expect(pay.status).toBe(200);
  const confirmed = await api(
    '/payments/mock/confirm',
    { method: 'POST', body: JSON.stringify({ outTradeNo: pay.body.data.outTradeNo }) },
    userToken,
  );
  expect(confirmed.status).toBe(200);

  const delivery = await prisma!.delivery.findUnique({ where: { orderId } });
  expect(delivery).toBeTruthy();
  return { orderId, deliveryId: delivery!.id };
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
    body: JSON.stringify({ code: 'seed_user', agreed: true, agreementVersion: AGREEMENT_VERSIONS.terms, privacyVersion: AGREEMENT_VERSIONS.privacy }),
  });
  userToken = login.body.data.token;

  const sku = await prisma.sku.findFirst({
    where: { status: 'ON_SALE' },
    orderBy: { code: 'asc' },
  });
  skuId = sku?.id ?? '';

  const address = await api(
    '/addresses',
    {
      method: 'POST',
      body: JSON.stringify({
        receiver: '配送契约收货人',
        phone: '13900002222',
        region: '云南省昆明市五华区',
        detail: '契约路 2 号',
        isDefault: true,
      }),
    },
    userToken,
  );
  addressId = address.body.data.id;
});

afterAll(async () => {
  await prisma?.$disconnect();
  prisma = null;
});

describe('配送范围、费用与时段容量', () => {
  it('范围外拦截；范围内按门店固定配送费计费；创建必须选时段', async () => {
    expect(skuId).toBeTruthy();
    const store = await createStore();

    const outOfRange = await api(
      '/orders/preview',
      {
        method: 'POST',
        body: JSON.stringify({
          items: [{ skuId, quantity: 1 }],
          fulfillmentType: 'DELIVERY',
          storeId: store.id,
          region: '云南省昆明市西山区',
        }),
      },
      userToken,
    );
    expect(outOfRange.status).toBe(400);
    expect(outOfRange.body?.message).toContain('配送范围');

    const inRange = await api(
      '/orders/preview',
      {
        method: 'POST',
        body: JSON.stringify({
          items: [{ skuId, quantity: 1 }],
          fulfillmentType: 'DELIVERY',
          storeId: store.id,
          deliverySlot: SLOT,
          region: '云南省昆明市五华区',
        }),
      },
      userToken,
    );
    expect(inRange.status).toBe(200);
    expect(inRange.body.data.fulfillmentType).toBe('DELIVERY');
    expect(inRange.body.data.delivery.region).toBe('云南省昆明市五华区');
    expect(inRange.body.data.amount.freightCents).toBe(800);
    expect(inRange.body.data.delivery.feeCents).toBe(800);

    const noSlot = await api(
      '/orders',
      {
        method: 'POST',
        headers: { 'idempotency-key': randomUUID() },
        body: JSON.stringify({
          items: [{ skuId, quantity: 1 }],
          fulfillmentType: 'DELIVERY',
          storeId: store.id,
          addressId,
        }),
      },
      userToken,
    );
    expect(noSlot.status).toBe(400);
    expect(noSlot.body?.message).toBe('请选择配送时段');

    const created = await api(
      '/orders',
      {
        method: 'POST',
        headers: { 'idempotency-key': randomUUID() },
        body: JSON.stringify(deliveryBody(store.id)),
      },
      userToken,
    );
    expect(created.status).toBe(201);
    expect(created.body.data.fulfillmentType).toBe('DELIVERY');
    expect(created.body.data.storeId).toBe(store.id);
    expect(created.body.data.deliverySlot).toBe(SLOT);
    expect(created.body.data.amount.freightCents).toBe(800);
  });

  it('每时段容量约满后拒绝新单', async () => {
    const store = await createStore({ maxOrdersPerSlot: 1 });

    const first = await api(
      '/orders',
      {
        method: 'POST',
        headers: { 'idempotency-key': randomUUID() },
        body: JSON.stringify(deliveryBody(store.id)),
      },
      userToken,
    );
    expect(first.status).toBe(201);

    const second = await api(
      '/orders',
      {
        method: 'POST',
        headers: { 'idempotency-key': randomUUID() },
        body: JSON.stringify(deliveryBody(store.id)),
      },
      userToken,
    );
    expect(second.status).toBe(400);
    expect(second.body?.message).toBe('该配送时段已约满');
  });
});

describe('配送状态、门店权限与取消', () => {
  it('支付创建 PENDING，接单 SHIPPED，送达 COMPLETED，重复操作幂等', async () => {
    const store = await createStore();
    const { orderId, deliveryId } = await createPaidDelivery(store.id);

    const pending = await api(`/admin/deliveries?storeId=${store.id}&status=PENDING`, {}, superToken);
    expect(pending.status).toBe(200);
    expect(pending.body.data.items.some((row: { id: string }) => row.id === deliveryId)).toBe(true);

    const accept = await api(
      `/admin/deliveries/${deliveryId}/accept`,
      { method: 'POST', body: JSON.stringify({ courierName: '契约骑手', courierPhone: '13700001111' }) },
      superToken,
    );
    expect(accept.status).toBe(200);
    expect(accept.body.data.alreadyAccepted).toBe(false);
    expect(accept.body.data.delivery.status).toBe('ACCEPTED');
    expect(accept.body.data.delivery.courierName).toBe('契约骑手');

    const acceptAgain = await api(
      `/admin/deliveries/${deliveryId}/accept`,
      { method: 'POST', body: JSON.stringify({ courierName: '另一位' }) },
      superToken,
    );
    expect(acceptAgain.status).toBe(200);
    expect(acceptAgain.body.data.alreadyAccepted).toBe(true);
    expect(acceptAgain.body.data.delivery.courierName).toBe('契约骑手');

    const shipped = await api(`/orders/${orderId}`, {}, userToken);
    expect(shipped.body.data.status).toBe('SHIPPED');
    expect(shipped.body.data.delivery.status).toBe('ACCEPTED');

    const deliver = await api(
      `/admin/deliveries/${deliveryId}/deliver`,
      { method: 'POST' },
      superToken,
    );
    expect(deliver.status).toBe(200);
    expect(deliver.body.data.alreadyDelivered).toBe(false);
    expect(deliver.body.data.delivery.status).toBe('DELIVERED');

    const deliverAgain = await api(
      `/admin/deliveries/${deliveryId}/deliver`,
      { method: 'POST' },
      superToken,
    );
    expect(deliverAgain.body.data.alreadyDelivered).toBe(true);

    const completed = await api(`/orders/${orderId}`, {}, userToken);
    expect(completed.body.data.status).toBe('COMPLETED');
    expect(completed.body.data.delivery.status).toBe('DELIVERED');

    const logs = await api(
      `/admin/logs?targetType=Delivery&keyword=${deliveryId}&pageSize=50`,
      {},
      superToken,
    );
    const actions = logs.body.data.items.map((row: { action: string }) => row.action);
    expect(actions).toContain('DELIVERY_ACCEPT');
    expect(actions).toContain('DELIVERY_COMPLETE');
  }, 60_000);

  it('取消必须填写原因；仅待接单/配送中可取消', async () => {
    const store = await createStore();
    const { deliveryId } = await createPaidDelivery(store.id);

    const noReason = await api(
      `/admin/deliveries/${deliveryId}/cancel`,
      { method: 'POST', body: JSON.stringify({}) },
      superToken,
    );
    expect(noReason.status).toBe(400);

    const cancel = await api(
      `/admin/deliveries/${deliveryId}/cancel`,
      { method: 'POST', body: JSON.stringify({ reason: '门店临时闭店' }) },
      superToken,
    );
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.delivery.status).toBe('CANCELLED');
    expect(cancel.body.data.delivery.remark).toBe('门店临时闭店');

    const again = await api(
      `/admin/deliveries/${deliveryId}/cancel`,
      { method: 'POST', body: JSON.stringify({ reason: '重复取消' }) },
      superToken,
    );
    expect(again.status).toBe(409);
  }, 60_000);

  it('总部可按多门店筛选配送单；配送订单不能走快递发货', async () => {
    const storeA = await createStore();
    const storeB = await createStore();
    const { orderId, deliveryId } = await createPaidDelivery(storeA.id);
    const other = await createPaidDelivery(storeB.id);

    const both = await api(
      `/admin/deliveries?storeIds=${storeA.id},${storeB.id}&pageSize=100`,
      {},
      superToken,
    );
    expect(both.status).toBe(200);
    const bothIds = both.body.data.items.map((row: { id: string }) => row.id);
    expect(bothIds).toContain(deliveryId);
    expect(bothIds).toContain(other.deliveryId);

    const onlyA = await api(`/admin/deliveries?storeIds=${storeA.id}&pageSize=100`, {}, superToken);
    expect(onlyA.status).toBe(200);
    expect(onlyA.body.data.items.every((row: { storeId: string }) => row.storeId === storeA.id)).toBe(
      true,
    );
    expect(onlyA.body.data.items.map((row: { id: string }) => row.id)).not.toContain(
      other.deliveryId,
    );

    const ship = await api(
      `/admin/orders/${orderId}/ship`,
      {
        method: 'POST',
        body: JSON.stringify({ expressCode: 'SF', expressName: '顺丰速运', trackingNo: 'SF123456789' }),
      },
      superToken,
    );
    expect(ship.status).toBe(409);
    expect(ship.body?.message).toContain('非快递订单');
  }, 60_000);
});

describe('看板时效与超时标识', () => {
  it('平均接单/送达时长、超时单数与列表 overdue 正确', async () => {
    const store = await createStore();
    const first = await createPaidDelivery(store.id);
    const second = await createPaidDelivery(store.id);

    const accept = await api(
      `/admin/deliveries/${first.deliveryId}/accept`,
      { method: 'POST', body: JSON.stringify({ courierName: '时效骑手' }) },
      superToken,
    );
    expect(accept.status).toBe(200);
    const deliver = await api(
      `/admin/deliveries/${first.deliveryId}/deliver`,
      { method: 'POST' },
      superToken,
    );
    expect(deliver.status).toBe(200);

    const now = Date.now();
    await prisma!.delivery.update({
      where: { id: first.deliveryId },
      data: {
        createdAt: new Date(now - 40 * 60_000),
        acceptedAt: new Date(now - 20 * 60_000),
        deliveredAt: new Date(now - 5 * 60_000),
      },
    });
    await prisma!.delivery.update({
      where: { id: second.deliveryId },
      data: { createdAt: new Date(now - 20 * 60_000) },
    });

    const dashboard = await api(`/admin/stores/${store.id}/dashboard`, {}, superToken);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.delivery.avgAcceptMinutes).toBe(20);
    expect(dashboard.body.data.delivery.avgDeliverMinutes).toBe(15);
    expect(dashboard.body.data.delivery.overdueCount).toBe(1);

    const list = await api(`/admin/deliveries?storeId=${store.id}`, {}, superToken);
    const rows = list.body.data.items as Array<{ id: string; overdue: boolean }>;
    expect(rows.find((row) => row.id === second.deliveryId)?.overdue).toBe(true);
    expect(rows.find((row) => row.id === first.deliveryId)?.overdue).toBe(false);
  }, 60_000);
});
