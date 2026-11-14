/**
 * 客户运营动作契约：发放优惠券、发放会员卡、调整会员等级（单人与批量共用接口）。
 */
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

let prisma: PrismaClient;
let adminToken = '';
let userId = '';
let couponId = '';
let planId = '';
let levelId = '';

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
  prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  // 直接签发超管令牌，避免 /admin/auth/login 的限流影响其它契约用例
  const jwt = new JwtService({ secret: process.env.JWT_SECRET ?? 'dev-secret-change-me' });
  adminToken = jwt.sign(
    {
      sub: 'contract-super',
      account: 'contract-super',
      name: '契约超管',
      kind: 'PC',
      isSuper: true,
      roleId: null,
      roleName: null,
    },
    { expiresIn: '1h' },
  );

  const user = await prisma.user.create({
    data: { openid: `dev_customer_ops_${Date.now()}`, nickname: '契约客户' },
    select: { id: true },
  });
  userId = user.id;

  const coupon = await prisma.coupon.findFirst({
    where: { enabled: true, perLimit: 1, startAt: { lt: new Date() }, endAt: { gt: new Date() } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!coupon) throw new Error('种子数据缺少可用优惠券');
  couponId = coupon.id;

  const plan = await prisma.memberCardPlan.findFirst({
    where: { enabled: true },
    orderBy: { priceCents: 'asc' },
    select: { id: true },
  });
  if (!plan) throw new Error('种子数据缺少会员卡方案');
  planId = plan.id;

  const level = await prisma.memberLevel.findFirst({
    orderBy: { thresholdCents: 'asc' },
    select: { id: true },
  });
  if (!level) throw new Error('种子数据缺少会员等级');
  levelId = level.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('客户运营动作', () => {
  it('可发放优惠券，且不会重复突破每人限领', async () => {
    const first = await api(
      '/admin/customers/batch/coupons',
      { method: 'POST', body: JSON.stringify({ userIds: [userId], couponId }) },
      adminToken,
    );
    expect(first.status).toBe(200);
    expect(first.body.data.granted).toBe(1);

    const again = await api(
      '/admin/customers/batch/coupons',
      { method: 'POST', body: JSON.stringify({ userIds: [userId], couponId }) },
      adminToken,
    );
    expect(again.status).toBe(200);
    expect(again.body.data.granted).toBe(0);
    expect(again.body.data.skipped.length).toBe(1);

    const claims = await prisma.couponClaim.count({ where: { userId, couponId } });
    expect(claims).toBe(1);
  });

  it('可发放会员卡并立即生效', async () => {
    const res = await api(
      '/admin/customers/batch/member-cards',
      { method: 'POST', body: JSON.stringify({ userIds: [userId], planId }) },
      adminToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.granted).toBe(1);

    const card = await prisma.memberCard.findFirst({
      where: { userId, status: 'ACTIVE', expireAt: { gt: new Date() } },
    });
    expect(card?.planId).toBe(planId);

    const missing = await api(
      '/admin/customers/batch/member-cards',
      { method: 'POST', body: JSON.stringify({ userIds: [userId], planId: 'not-exist' }) },
      adminToken,
    );
    expect(missing.status).toBe(404);
  });

  it('可调整与清除会员等级', async () => {
    const updated = await api(
      '/admin/customers/batch/levels',
      { method: 'POST', body: JSON.stringify({ userIds: [userId], levelId }) },
      adminToken,
    );
    expect(updated.status).toBe(200);
    expect(updated.body.data.updated).toBe(1);
    const assigned = await prisma.user.findUnique({ where: { id: userId } });
    expect(assigned?.levelId).toBe(levelId);

    const cleared = await api(
      '/admin/customers/batch/levels',
      { method: 'POST', body: JSON.stringify({ userIds: [userId], levelId: null }) },
      adminToken,
    );
    expect(cleared.status).toBe(200);
    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.levelId).toBeNull();
  });

  it('空客户列表与不存在的等级被拒绝', async () => {
    const empty = await api(
      '/admin/customers/batch/coupons',
      { method: 'POST', body: JSON.stringify({ userIds: [], couponId }) },
      adminToken,
    );
    expect(empty.status).toBe(400);

    const badLevel = await api(
      '/admin/customers/batch/levels',
      { method: 'POST', body: JSON.stringify({ userIds: [userId], levelId: 'not-exist' }) },
      adminToken,
    );
    expect(badLevel.status).toBe(404);
  });
});
