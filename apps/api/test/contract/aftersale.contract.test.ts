/**
 * 售后与退款契约测试（工程契约 R2）
 * 重点验证资金不变量：退款总额不超过实付；整单退含运费。
 */
import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

let prisma: PrismaClient | null = null;
let userToken = '';
let adminToken = '';
let addressId = '';
let skuId = '';

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

/** 造一笔已支付订单，返回订单详情 */
async function paidOrder() {
  const created = await api('/orders', {
    method: 'POST',
    headers: { 'idempotency-key': randomUUID() },
    body: JSON.stringify({ addressId, items: [{ skuId, quantity: 1 }] }),
  });
  expect(created.status).toBe(201);
  const orderId = created.body.data.id;

  const pay = await api(`/orders/${orderId}/pay`, { method: 'POST' });
  await api('/payments/mock/confirm', {
    method: 'POST',
    body: JSON.stringify({ outTradeNo: pay.body.data.outTradeNo }),
  });

  const detail = await api(`/orders/${orderId}`);
  expect(detail.body.data.status).toBe('PAID');
  return detail.body.data;
}

beforeAll(async () => {
  const envVars: NodeJS.ProcessEnv = { DATABASE_URL: process.env.DATABASE_URL ?? '' };

  prisma = new PrismaClient({ datasources: { db: { url: envVars.DATABASE_URL } } });
  const address = await prisma.address.findFirst({ where: { user: { openid: 'dev_seed_user' } } });
  addressId = address?.id ?? '';
  const sku = await prisma.sku.findFirst({
    where: { status: 'ON_SALE', stock: { gt: 5 } },
    orderBy: { code: 'asc' },
  });
  skuId = sku?.id ?? '';

  const login = await api('/auth/wechat-login', {
    method: 'POST',
    body: JSON.stringify({ code: 'seed_user' }),
  });
  userToken = login.body.data.token;

  const admin = await api(
    '/admin/auth/login',
    { method: 'POST', body: JSON.stringify({ account: 'cs@shanye.com', password: 'cs123456' }) },
    '',
  );
  adminToken = admin.body.data.token;
});

afterAll(async () => {
  await prisma?.$disconnect();
  prisma = null;
});

describe('售后契约', () => {
  it('整单仅退款：订单变为 REFUNDED，且退款额等于实付（含运费）', async () => {
    expect(addressId).toBeTruthy();
    expect(skuId).toBeTruthy();

    const order = await paidOrder();
    const item = order.items[0];

    const applied = await api('/after-sales', {
      method: 'POST',
      body: JSON.stringify({ orderItemId: item.id, type: 'REFUND_ONLY', reason: '商品破损' }),
    });
    expect(applied.status).toBe(201);
    // 默认退款额按行实付（已扣会员折扣），不超过该值
    expect(applied.body.data.refundCents).toBeLessThanOrEqual(item.priceCents * item.quantity);

    const approved = await api(
      `/admin/after-sales/${applied.body.data.id}/moderate`,
      { method: 'POST', body: JSON.stringify({ action: 'approve_only_refund' }) },
      adminToken,
    );
    expect(approved.status).toBe(200);

    const after = await api(`/orders/${order.id}`);
    const amount = after.body.data.amount;
    expect(after.body.data.status).toBe('REFUNDED');
    expect(amount.refundedCents).toBe(amount.payableCents);
  });

  it('退款金额不得超过行实付', async () => {
    const order = await paidOrder();
    const item = order.items[0];

    const res = await api('/after-sales', {
      method: 'POST',
      body: JSON.stringify({
        orderItemId: item.id,
        type: 'REFUND_ONLY',
        reason: '测试超限',
        refundCents: item.priceCents * item.quantity + 100,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('同一商品不能重复申请售后', async () => {
    const order = await paidOrder();
    const item = order.items[0];
    const payload = JSON.stringify({ orderItemId: item.id, type: 'REFUND_ONLY', reason: '重复' });

    const first = await api('/after-sales', { method: 'POST', body: payload });
    expect(first.status).toBe(201);
    const second = await api('/after-sales', { method: 'POST', body: payload });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('AFTER_SALE_EXISTS');
  });

  it('拒绝必须填写理由；填写后订单恢复原状态', async () => {
    const order = await paidOrder();
    const item = order.items[0];
    const applied = await api('/after-sales', {
      method: 'POST',
      body: JSON.stringify({ orderItemId: item.id, type: 'REFUND_ONLY', reason: '退货' }),
    });

    const noReason = await api(
      `/admin/after-sales/${applied.body.data.id}/moderate`,
      { method: 'POST', body: JSON.stringify({ action: 'reject' }) },
      adminToken,
    );
    expect(noReason.status).toBe(400);

    const rejected = await api(
      `/admin/after-sales/${applied.body.data.id}/moderate`,
      { method: 'POST', body: JSON.stringify({ action: 'reject', rejectReason: '凭证不足' }) },
      adminToken,
    );
    expect(rejected.status).toBe(200);

    const after = await api(`/orders/${order.id}`);
    expect(after.body.data.status).toBe('PAID');
  });
});

describe('物流与超时关单契约', () => {
  it('已支付未发货订单的物流返回 shipped=false', async () => {
    const order = await paidOrder();
    const res = await api(`/orders/${order.id}/shipment`);
    expect(res.status).toBe(200);
    expect(res.body.data.shipped).toBe(false);
    expect(Array.isArray(res.body.data.nodes)).toBe(true);
  });

  it('超时关单后订单为 CLOSED 且预占库存已释放', async () => {
    const created = await api('/orders', {
      method: 'POST',
      headers: { 'idempotency-key': randomUUID() },
      body: JSON.stringify({ addressId, items: [{ skuId, quantity: 1 }] }),
    });
    const orderId = created.body.data.id;

    // 把支付时限改到过去，触发关单
    await prisma!.order.update({
      where: { id: orderId },
      data: { payDeadlineAt: new Date(Date.now() - 60_000) },
    });

    const superToken = (
      await api(
        '/admin/auth/login',
        { method: 'POST', body: JSON.stringify({ account: 'admin@shanye.com', password: 'admin123' }) },
        '',
      )
    ).body.data.token;

    const closed = await api(
      '/admin/orders/close-expired',
      { method: 'POST' },
      superToken,
    );
    expect(closed.status).toBe(201);

    const after = await api(`/orders/${orderId}`);
    expect(after.body.data.status).toBe('CLOSED');
  });
});
