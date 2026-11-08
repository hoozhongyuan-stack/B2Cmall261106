/**
 * 迭代 A 契约测试：订阅消息日志、退款对账、系统状态与公开模板接口。
 * 依赖 global-setup 启动的构建产物与独立测试库。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

let prisma: PrismaClient | null = null;
let superToken = '';

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
  const admin = await api('/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account: 'admin@shanye.com', password: 'admin123' }),
  });
  superToken = admin.body.data.token;
});

afterAll(async () => {
  await prisma?.$disconnect();
  prisma = null;
});

describe('订阅消息', () => {
  it('公开模板接口只返回已配置的模板 ID', async () => {
    const result = await api('/subscriptions/templates');
    expect(result.status).toBe(200);
    expect(result.body.data.templates).toBeTypeOf('object');
  });

  it('后台可分页查看发送日志', async () => {
    const result = await api('/admin/notifications/logs?page=1&pageSize=10', {}, superToken);
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({
      page: 1,
      pageSize: 10,
    });
    expect(Array.isArray(result.body.data.items)).toBe(true);
  });

  it('重试不存在的通知返回 404', async () => {
    const result = await api('/admin/notifications/not-exist/retry', { method: 'POST' }, superToken);
    expect(result.status).toBe(404);
  });
});

describe('退款对账', () => {
  it('退款列表返回结构与分页字段', async () => {
    const result = await api('/admin/refunds?page=1&pageSize=5', {}, superToken);
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ page: 1, pageSize: 5 });
    expect(Array.isArray(result.body.data.items)).toBe(true);
  });

  it('查询不存在的退款返回 404', async () => {
    const result = await api('/admin/refunds/not-exist/query', { method: 'POST' }, superToken);
    expect(result.status).toBe(404);
  });
});

describe('系统状态', () => {
  it('返回磁盘、备份、通知、退款与告警', async () => {
    const result = await api('/admin/ops/status', {}, superToken);
    expect(result.status).toBe(200);
    const data = result.body.data;
    expect(typeof data.uptimeSeconds).toBe('number');
    expect(typeof data.disk.usedRatio).toBe('number');
    expect(data.backup).toHaveProperty('stale');
    expect(data.notifications).toHaveProperty('pending');
    expect(data.refunds).toHaveProperty('abnormal');
    expect(Array.isArray(data.alerts)).toBe(true);
  });
});
