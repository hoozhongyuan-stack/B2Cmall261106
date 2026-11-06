/**
 * 客户资产与复购链路契约测试（工程契约 R2）
 * 覆盖：领券 / 核销 / 退券、积分发放与扣回、等级升降、客户视图、评价审核。
 */
import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

let prisma: PrismaClient | null = null;
let userToken = '';
let userId = '';
let superToken = '';
let skuId = '';
let addressId = '';

/** 领券 → 下单 → 支付 */
async function createOrder(input: { couponClaimId?: string } = {}) {
  const created = await api('/orders', {
    method: 'POST',
    headers: { 'idempotency-key': randomUUID() },
    body: JSON.stringify({
      addressId,
      items: [{ skuId, quantity: 1 }],
      ...(input.couponClaimId ? { couponClaimId: input.couponClaimId } : {}),
    }),
  });
  expect(created.status).toBe(201);
  return created.body.data;
}

async function pay(orderId: string) {
  const params = await api(`/orders/${orderId}/pay`, { method: 'POST' });
  const confirmed = await api('/payments/mock/confirm', {
    method: 'POST',
    body: JSON.stringify({ outTradeNo: params.body.data.outTradeNo }),
  });
  expect(confirmed.status).toBe(200);
  const detail = await api(`/orders/${orderId}`);
  expect(detail.body.data.status).toBe('PAID');
  return detail.body.data;
}

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

  const sku = await prisma.sku.findFirst({
    where: { status: 'ON_SALE', stock: { gt: 5 } },
    orderBy: { code: 'asc' },
  });
  skuId = sku?.id ?? '';

  // 独立用户：避免与他人累计消费/积分互相影响
  const login = await api('/auth/wechat-login', {
    method: 'POST',
    body: JSON.stringify({ code: `growth_${Date.now()}` }),
  });
  userToken = login.body.data.token;
  userId = login.body.data.user.id;

  const address = await prisma.address.create({
    data: {
      userId,
      receiver: '增长测试',
      phone: '13800000000',
      region: '云南省昆明市五华区',
      detail: '测试地址 1 号',
      isDefault: true,
    },
  });
  addressId = address.id;

  const admin = await api(
    '/admin/auth/login',
    { method: 'POST', body: JSON.stringify({ account: 'admin@shanye.com', password: 'admin123' }) },
    '',
  );
  superToken = admin.body.data.token;
});

afterAll(async () => {
  await prisma?.$disconnect();
  prisma = null;
});

let couponId = '';
let claimId = '';
let orderId = '';
let orderItemId = '';
let payableCents = 0;

describe('优惠券：领取、限领与状态', () => {
  it('后台新建券后可在领券中心领取，重复领取被限领规则拒绝', async () => {
    const created = await api(
      '/admin/coupons',
      {
        method: 'POST',
        body: JSON.stringify({
          name: `满 100 减 5 · ${Date.now()}`,
          thresholdCents: 10000,
          faceValueCents: 500,
          total: 5,
          perLimit: 1,
          startAt: new Date(Date.now() - 86_400_000).toISOString(),
          endAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        }),
      },
      superToken,
    );
    expect(created.status).toBe(201);
    couponId = created.body.data.id;

    const list = await api('/coupons');
    const target = list.body.data.items.find((c: { id: string }) => c.id === couponId);
    expect(target?.canClaim).toBe(true);

    const claim = await api(`/coupons/${couponId}/claim`, { method: 'POST' });
    expect(claim.status).toBe(200);
    claimId = claim.body.data.id;

    const again = await api(`/coupons/${couponId}/claim`, { method: 'POST' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('COUPON_CLAIM_LIMIT');

    const mine = await api('/coupons/mine?status=UNUSED');
    expect(mine.body.data.items.some((c: { id: string }) => c.id === claimId)).toBe(true);
  });
});

describe('积分与等级：支付发放、退款扣回', () => {
  it('用券下单后券被核销，支付成功按实付发放积分并升级', async () => {
    // 造一个低门槛等级，验证「按累计消费升级」而非人工指定
    const level = await api(
      '/admin/member-levels',
      {
        method: 'POST',
        body: JSON.stringify({
          name: `增长会员${Date.now()}`,
          thresholdCents: 1000,
          discountRate: 0.9,
        }),
      },
      superToken,
    );
    expect(level.status).toBe(201);

    const order = await createOrder({ couponClaimId: claimId });
    orderId = order.id;
    orderItemId = order.items[0].id;
    payableCents = order.amount.payableCents;
    expect(order.amount.couponCents).toBe(500);

    const used = await api('/coupons/mine?status=USED');
    expect(used.body.data.items.some((c: { id: string }) => c.id === claimId)).toBe(true);

    const paid = await pay(orderId);
    expect(paid.status).toBe('PAID');

    const profile = await api('/member/profile');
    expect(profile.body.data.points).toBe(Math.floor(payableCents / 100));
    expect(profile.body.data.totalSpentCents).toBe(payableCents);
    expect(profile.body.data.level.discountRate).toBe(0.9);
    expect(profile.body.data.nextLevel).toBeTruthy();

    const points = await api('/member/points');
    expect(points.body.data.items[0].source).toBe('ORDER_PAID');
    expect(points.body.data.balance).toBe(Math.floor(payableCents / 100));
  });

  it('整单退款后积分与累计消费归零、等级回落、优惠券退回', async () => {
    const applied = await api('/after-sales', {
      method: 'POST',
      body: JSON.stringify({ orderItemId, type: 'REFUND_ONLY', reason: '测试退券' }),
    });
    expect(applied.status).toBe(201);

    const approved = await api(
      `/admin/after-sales/${applied.body.data.id}/moderate`,
      { method: 'POST', body: JSON.stringify({ action: 'approve_only_refund' }) },
      superToken,
    );
    expect(approved.status).toBe(200);

    const after = await api(`/orders/${orderId}`);
    expect(after.body.data.status).toBe('REFUNDED');

    const profile = await api('/member/profile');
    expect(profile.body.data.points).toBe(0);
    expect(profile.body.data.totalSpentCents).toBe(0);
    expect(profile.body.data.level?.discountRate ?? 1).toBe(1);

    const points = await api('/member/points');
    expect(points.body.data.items[0].source).toBe('REFUND');
    expect(points.body.data.items[0].delta).toBe(-Math.floor(payableCents / 100));

    const mine = await api('/coupons/mine?status=UNUSED');
    expect(mine.body.data.items.some((c: { id: string }) => c.id === claimId)).toBe(true);
  });
});

describe('优惠券：取消订单自动退回', () => {
  it('后台发放的券在下单取消后回到未使用', async () => {
    const created = await api(
      '/admin/coupons',
      {
        method: 'POST',
        body: JSON.stringify({
          name: `取消退券 · ${Date.now()}`,
          faceValueCents: 300,
          total: 3,
          perLimit: 1,
          startAt: new Date(Date.now() - 86_400_000).toISOString(),
          endAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        }),
      },
      superToken,
    );
    const granted = await api(
      `/admin/coupons/${created.body.data.id}/grant`,
      { method: 'POST', body: JSON.stringify({ userIds: [userId] }) },
      superToken,
    );
    expect(granted.body.data.granted).toBe(1);

    const mine = await api('/coupons/mine?status=UNUSED');
    const claim = mine.body.data.items.find(
      (c: { couponId: string }) => c.couponId === created.body.data.id,
    );
    expect(claim).toBeTruthy();

    const order = await createOrder({ couponClaimId: claim.id });
    const cancelled = await api(`/orders/${order.id}/cancel`, { method: 'POST' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CLOSED');

    const returned = await api('/coupons/mine?status=UNUSED');
    expect(returned.body.data.items.some((c: { id: string }) => c.id === claim.id)).toBe(true);
  });
});

describe('评价：先审后显与商家回复', () => {
  let reviewId = '';
  let productId = '';

  it('已完成订单才能评价，评价默认待审核且公开页不可见', async () => {
    const order = await createOrder();
    await pay(order.id);

    const shipped = await api(
      `/admin/orders/${order.id}/ship`,
      {
        method: 'POST',
        body: JSON.stringify({ expressCode: 'SF', expressName: '顺丰速运', trackingNo: 'SF123' }),
      },
      superToken,
    );
    expect(shipped.status).toBe(200);

    const confirmed = await api(`/orders/${order.id}/confirm`, { method: 'POST' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe('COMPLETED');

    const review = await api('/reviews', {
      method: 'POST',
      body: JSON.stringify({
        orderItemId: order.items[0].id,
        rating: 5,
        content: '很好喝，回甘明显',
      }),
    });
    expect(review.status).toBe(201);
    expect(review.body.data.status).toBe('PENDING');
    reviewId = review.body.data.id;

    const duplicate = await api('/reviews', {
      method: 'POST',
      body: JSON.stringify({ orderItemId: order.items[0].id, rating: 4 }),
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('REVIEW_EXISTS');

    const sku = await prisma!.sku.findUnique({
      where: { id: order.items[0].skuId },
      select: { productId: true },
    });
    productId = sku!.productId;

    const publicList = await api(`/products/${productId}/reviews`, {}, '');
    expect(publicList.body.data.items.some((r: { id: string }) => r.id === reviewId)).toBe(false);
  });

  it('审核通过后公开可见，商家回复写入评价', async () => {
    const moderated = await api(
      `/admin/reviews/${reviewId}/moderate`,
      { method: 'POST', body: JSON.stringify({ action: 'show' }) },
      superToken,
    );
    expect(moderated.status).toBe(200);

    const publicList = await api(`/products/${productId}/reviews`, {}, '');
    expect(publicList.body.data.summary.count).toBeGreaterThan(0);
    expect(publicList.body.data.items.some((r: { id: string }) => r.id === reviewId)).toBe(true);

    const replied = await api(
      `/admin/reviews/${reviewId}/reply`,
      { method: 'POST', body: JSON.stringify({ content: '感谢支持，欢迎回购' }) },
      superToken,
    );
    expect(replied.status).toBe(200);

    const mine = await api('/reviews/mine');
    const target = mine.body.data.items.find((r: { id: string }) => r.id === reviewId);
    expect(target.status).toBe('SHOWN');
    expect(target.reply).toContain('感谢支持');
  });
});

describe('客户视图：列表与详情', () => {
  let baselinePoints = 0;

  it('客户列表能查到该用户，详情带订单与积分流水', async () => {
    const user = await prisma!.user.findUnique({ where: { id: userId } });
    const profile = await api('/member/profile');
    baselinePoints = profile.body.data.points;

    const list = await api(
      `/admin/customers?keyword=${encodeURIComponent(user!.openid)}`,
      {},
      superToken,
    );
    expect(list.status).toBe(200);
    const row = list.body.data.items.find((c: { id: string }) => c.id === userId);
    expect(row).toBeTruthy();
    expect(row.orderCount).toBeGreaterThan(0);
    expect(row.points).toBe(baselinePoints);

    const detail = await api(`/admin/customers/${userId}`, {}, superToken);
    expect(detail.status).toBe(200);
    expect(detail.body.data.stats.orderCount).toBeGreaterThan(0);
    expect(detail.body.data.recentOrders.length).toBeGreaterThan(0);
    expect(detail.body.data.recentPoints.length).toBeGreaterThan(0);
  });

  it('后台手动调整积分：发放与扣减都写入流水，余额不为负', async () => {
    const plus = await api(
      `/admin/customers/${userId}/points`,
      { method: 'POST', body: JSON.stringify({ delta: 100, reason: '客服补偿' }) },
      superToken,
    );
    expect(plus.status).toBe(200);
    expect(plus.body.data.balance).toBe(baselinePoints + 100);

    const minus = await api(
      `/admin/customers/${userId}/points`,
      { method: 'POST', body: JSON.stringify({ delta: -100000, reason: '测试清零' }) },
      superToken,
    );
    expect(minus.status).toBe(200);
    expect(minus.body.data.balance).toBe(0);

    const ledger = await api('/member/points');
    expect(ledger.body.data.balance).toBe(0);
    expect(ledger.body.data.items[0].source).toBe('ADMIN');
  });
});
