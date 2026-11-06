/**
 * 契约测试（工程契约 R2）
 * 方式：启动构建产物 dist/main.js，用真实 HTTP 请求校验
 *      —— 只依赖对外行为，不依赖内部 DI，且顺带验证打包产物可用。
 * 运行：pnpm test:contract
 * 前置：DATABASE_URL 可写（迁移与种子已执行）、已 pnpm build:api
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { load } from 'js-yaml';
import OpenApiResponseValidatorModule from 'openapi-response-validator';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const OpenApiResponseValidator =
  (OpenApiResponseValidatorModule as unknown as { default?: typeof OpenApiResponseValidatorModule })
    .default ?? OpenApiResponseValidatorModule;

const ROOT = join(__dirname, '../../../..');
const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

const spec = load(readFileSync(join(ROOT, 'openapi.yaml'), 'utf8')) as {
  paths: Record<string, { post: { responses: Record<string, unknown> } }>;
  components: Record<string, unknown>;
};
const orderValidator = new OpenApiResponseValidator({
  responses: spec.paths['/orders'].post.responses as never,
  components: spec.components as never,
});

let child: ChildProcess | null = null;
let prisma: PrismaClient | null = null;
let token = '';
let addressId = '';
let skuId = '';

function env(): NodeJS.ProcessEnv {
  const envPath = join(ROOT, 'apps/api/.env');
  const parsed: Record<string, string> = { ...process.env } as Record<string, string>;
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
      if (m) parsed[m[1]] = m[2];
    }
  }
  parsed.PORT = String(PORT);
  return parsed;
}

async function waitForHealth(timeoutMs = 25_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* 服务尚未就绪 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('API 未在规定时间内就绪');
}

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

beforeAll(async () => {
  const envVars = env();
  child = spawn('node', ['dist/main.js'], {
    cwd: join(ROOT, 'apps/api'),
    env: envVars,
    stdio: 'ignore',
  });
  await waitForHealth();

  // 测试夹具：直接读库取地址与 SKU（测试层允许使用 Prisma）
  prisma = new PrismaClient({ datasources: { db: { url: envVars.DATABASE_URL } } });
  const address = await prisma.address.findFirst({ where: { user: { openid: 'dev_seed_user' } } });
  addressId = address?.id ?? '';
  const sku = await prisma.sku.findFirst({
    where: { status: 'ON_SALE', stock: { gt: 2 } },
    orderBy: { code: 'asc' },
  });
  skuId = sku?.id ?? '';

  const login = await api('/auth/wechat-login', {
    method: 'POST',
    body: JSON.stringify({ code: 'seed_user' }),
  });
  if (login.status !== 200) {
    throw new Error(`登录失败：${login.status} ${JSON.stringify(login.body)}`);
  }
  token = login.body.data.token;
});

afterAll(async () => {
  child?.kill('SIGTERM');
  child = null;
  await prisma?.$disconnect();
  prisma = null;
});

describe('骨架契约', () => {
  it('GET /health 返回 status 与 requestId', async () => {
    const res = await api('/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('status');
    expect(res.body.data.db).toBe(true);
    expect(typeof res.body.requestId).toBe('string');
  });

  it('GET /shop 金额字段为整数分', async () => {
    const res = await api('/shop');
    expect(Number.isInteger(res.body.data.freeThresholdCents)).toBe(true);
    expect(Number.isInteger(res.body.data.flatFreightCents)).toBe(true);
  });

  it('GET /cart 未登录返回 401', async () => {
    const saved = token;
    token = '';
    const res = await api('/cart');
    token = saved;
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_UNAUTHORIZED');
  });
});

describe('购物车契约', () => {
  it('GET /cart 返回 valid / invalid / summary 三段结构', async () => {
    const res = await api('/cart');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.valid)).toBe(true);
    expect(Array.isArray(res.body.data.invalid)).toBe(true);
    expect(res.body.data.summary).toHaveProperty('checkedAmountCents');
  });
});

describe('下单契约（R2 核心）', () => {
  it('响应结构符合 openapi.yaml，且应付金额自洽', async () => {
    expect(addressId, '种子数据缺少收货地址').toBeTruthy();
    expect(skuId, '种子数据缺少可售 SKU').toBeTruthy();

    const res = await api('/orders', {
      method: 'POST',
      headers: { 'idempotency-key': `contract-${randomUUID()}` },
      body: JSON.stringify({ addressId, items: [{ skuId, quantity: 1 }] }),
    });
    expect(res.status).toBe(201);

    const errors = orderValidator.validateResponse(201, res.body);
    if (errors) throw new Error(`响应与契约不一致：${JSON.stringify(errors)}`);

    const a = res.body.data.amount;
    expect(a.payableCents).toBe(
      a.goodsCents - a.memberDiscountCents - a.couponCents + a.freightCents,
    );
  });

  it('请求体出现 points 字段被拒绝（订单不支持积分抵扣）', async () => {
    const res = await api('/orders', {
      method: 'POST',
      headers: { 'idempotency-key': `contract-${randomUUID()}` },
      body: JSON.stringify({ addressId, items: [{ skuId, quantity: 1 }], points: 100 }),
    });
    expect(res.status).toBe(400);
  });

  it('缺少 Idempotency-Key 返回 400', async () => {
    const res = await api('/orders', {
      method: 'POST',
      body: JSON.stringify({ addressId, items: [{ skuId, quantity: 1 }] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('后台权限契约', () => {
  it('未登录访问后台订单列表返回 401', async () => {
    const saved = token;
    token = '';
    const res = await api('/admin/orders');
    token = saved;
    expect(res.status).toBe(401);
  });

  it('客服角色不能发货（403）', async () => {
    const saved = token;
    token = '';
    const login = await api('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ account: 'cs@shanye.com', password: 'cs123456' }),
    });
    token = login.body.data.token;
    const res = await api('/admin/orders/not-exist/ship', {
      method: 'POST',
      body: JSON.stringify({ expressCode: 'SF', expressName: '顺丰速运', trackingNo: 'SF1' }),
    });
    token = saved;
    expect(res.status).toBe(403);
  });
});
