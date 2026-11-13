/**
 * 迭代 C 契约测试：会员卡购买、储值充值、折扣取最优、余额支付与退款回余额。
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
let productId = '';
let orderId = '';
let balanceBeforePay = 0;

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
    where: { status: 'ON_SALE', stock: { gt: 2 } },
    orderBy: { code: 'asc' },
  });
  addressId = address?.id ?? '';
  skuId = sku?.id ?? '';
  productId = sku?.productId ?? '';
  if (!addressId || !skuId) throw new Error('种子数据缺少地址或 SKU');
});

afterAll(async () => {
  await prisma?.$disconnect();
  prisma = null;
});

describe('会员卡与储值', () => {
  it('会员卡方案与充值套餐可用', async () => {
    const plans = await api('/member-cards/plans', {}, '');
    expect(plans.status).toBe(200);
    expect(plans.body.data.items.length).toBeGreaterThan(0);

    const adminPlans = await api('/admin/member-card-plans', {}, superToken);
    expect(adminPlans.status).toBe(200);
    const recharges = await api('/admin/recharge-plans', {}, superToken);
    expect(recharges.status).toBe(200);
    expect(recharges.body.data.items.length).toBeGreaterThan(0);
  });

  it('充值后余额与流水同步增加', async () => {
    const recharge = await api(
      '/stored-value/recharge',
      { method: 'POST', body: JSON.stringify({ planId: 'rpp_1000' }) },
      userToken,
    );
    expect(recharge.status).toBe(200);
    expect(recharge.body.data.creditedCents).toBe(120000);

    const wallet = await api('/stored-value', {}, userToken);
    expect(wallet.status).toBe(200);
    expect(wallet.body.data.balanceCents).toBe(120000);
    expect(wallet.body.data.ledger[0].type).toBe('RECHARGE');
  });

  it('购买会员卡后余额扣减且权益生效', async () => {
    const purchase = await api(
      '/member-cards/purchase',
      { method: 'POST', body: JSON.stringify({ planId: 'mcp_month' }) },
      userToken,
    );
    expect(purchase.status).toBe(200);
    expect(purchase.body.data.planName).toBe('山野月卡');

    const membership = await api('/member-cards/mine', {}, userToken);
    expect(membership.body.data.card.status).toBe('ACTIVE');
    expect(membership.body.data.balanceCents).toBe(120000 - 1990);
  });

  it('结算按等级折扣与会员卡折扣取最优', async () => {
    const preview = await api(
      '/orders/preview',
      { method: 'POST', body: JSON.stringify({ items: [{ skuId, quantity: 1 }] }) },
      userToken,
    );
    expect(preview.status).toBe(200);
    expect(preview.body.data.member.cardName).toBe('山野月卡');
    expect(preview.body.data.member.rate).toBe(0.95);
    expect(preview.body.data.amount.memberDiscountCents).toBeGreaterThan(0);
  });

  it('余额支付订单后余额减少并生成支付流水', async () => {
    const created = await api(
      '/orders',
      {
        method: 'POST',
        headers: { 'idempotency-key': randomUUID() },
        body: JSON.stringify({ addressId, items: [{ skuId, quantity: 1 }] }),
      },
      userToken,
    );
    expect(created.status).toBe(201);
    orderId = created.body.data.id;

    const walletBefore = await api('/stored-value', {}, userToken);
    balanceBeforePay = walletBefore.body.data.balanceCents;

    const paid = await api(`/orders/${orderId}/pay-balance`, { method: 'POST' }, userToken);
    expect(paid.status).toBe(200);
    expect(paid.body.data.status).toBe('PAID');

    const walletAfter = await api('/stored-value', {}, userToken);
    expect(walletAfter.body.data.balanceCents).toBe(
      balanceBeforePay - paid.body.data.amount.payableCents,
    );
    expect(walletAfter.body.data.ledger[0].type).toBe('BALANCE_PAY');
  });

  it('售后退款原路退回储值余额', async () => {
    const order = await api(`/orders/${orderId}`, {}, userToken);
    const itemId = order.body.data.items[0].id as string;

    const applied = await api(
      '/after-sales',
      {
        method: 'POST',
        body: JSON.stringify({ orderItemId: itemId, type: 'REFUND_ONLY', reason: '契约测试退款' }),
      },
      userToken,
    );
    expect(applied.status).toBe(201);
    const afterSaleId = applied.body.data.id as string;

    const approved = await api(
      `/admin/after-sales/${afterSaleId}/moderate`,
      { method: 'POST', body: JSON.stringify({ action: 'approve_only_refund' }) },
      superToken,
    );
    expect(approved.status).toBe(200);

    const wallet = await api('/stored-value', {}, userToken);
    expect(wallet.body.data.balanceCents).toBe(balanceBeforePay);
    expect(wallet.body.data.ledger[0].type).toBe('REFUND');
  });

  it('后台可查看会员卡、储值账户与资金流水', async () => {
    const cards = await api('/admin/member-cards?page=1&pageSize=10', {}, superToken);
    expect(cards.status).toBe(200);
    expect(cards.body.data.items.length).toBeGreaterThan(0);

    const accounts = await api('/admin/stored-value/accounts', {}, superToken);
    expect(accounts.status).toBe(200);

    const ledger = await api('/admin/stored-value/ledger', {}, superToken);
    expect(ledger.status).toBe(200);
    expect(ledger.body.data.items.length).toBeGreaterThan(0);

    const recharges = await api('/admin/recharge-orders', {}, superToken);
    expect(recharges.status).toBe(200);
    expect(recharges.body.data.items.length).toBeGreaterThan(0);
  });

  it('个人资料可维护昵称与头像', async () => {
    const nickname = `契约昵称${Date.now().toString().slice(-6)}`;
    const updated = await api(
      '/member/profile',
      { method: 'PATCH', body: JSON.stringify({ nickname }) },
      userToken,
    );
    expect(updated.status).toBe(200);
    expect(updated.body.data.nickname).toBe(nickname);

    const empty = await api(
      '/member/profile',
      { method: 'PATCH', body: JSON.stringify({ nickname: '   ' }) },
      userToken,
    );
    expect(empty.status).toBe(400);

    // 头像上传后保存素材 key
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'avatar.png');
    const upload = await fetch(`${BASE}/member/avatar`, {
      method: 'POST',
      headers: { authorization: `Bearer ${userToken}` },
      body: form,
    });
    const uploadBody = (await upload.json()) as {
      data?: { key?: string };
    };
    expect(upload.status).toBe(200);
    expect(uploadBody.data?.key).toBeTruthy();

    const saved = await api(
      '/member/profile',
      { method: 'PATCH', body: JSON.stringify({ avatarKey: uploadBody.data?.key }) },
      userToken,
    );
    expect(saved.status).toBe(200);
    expect(saved.body.data.avatarKey).toBe(uploadBody.data?.key);

    const profile = await api('/member/profile', {}, userToken);
    expect(profile.body.data.avatarKey).toBe(uploadBody.data?.key);
  });

  it('商品详情返回会员卡 VIP 价信息', async () => {
    const anonymous = await api(`/products/${productId}`, {}, '');
    expect(anonymous.status).toBe(200);
    expect(anonymous.body.data.memberCard.planName).toBeTruthy();
    expect(anonymous.body.data.memberCard.discountRate).toBeLessThan(1);
    expect(anonymous.body.data.memberCard.active).toBe(false);

    // 当前用户已购卡：返回生效状态与实际折扣
    const logged = await api(`/products/${productId}`, {}, userToken);
    expect(logged.body.data.memberCard.active).toBe(true);
    expect(logged.body.data.memberCard.userRate).toBe(0.95);
  });
});
