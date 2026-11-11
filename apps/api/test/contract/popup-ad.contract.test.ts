/**
 * 弹窗广告契约：启用/时间过滤、优先级排序、图片与链接校验。
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

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

let admin = '';
const created: string[] = [];

async function createAd(data: Record<string, unknown>): Promise<{ id: string }> {
  const res = await api('/admin/popup-ads', { method: 'POST', body: JSON.stringify(data) }, admin);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.push(res.body.data.id);
  return res.body.data;
}

function baseAd(name: string, priority: number) {
  return {
    name,
    imageKey: 'products/tea-01.jpg',
    alt: '测试弹窗',
    link: { type: 'page', value: '/pages/orders/index' },
    priority,
    enabled: true,
    startAt: null,
    endAt: null,
  };
}

beforeAll(async () => {
  const login = await api('/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account: 'admin@shanye.com', password: 'admin123' }),
  });
  expect(login.status).toBe(200);
  admin = login.body.data.token as string;
});

describe('弹窗广告：下发与排序', () => {
  it('按优先级返回启用广告，停用后移除', async () => {
    const low = await createAd(baseAd('契约低优先', 1));
    const high = await createAd(baseAd('契约高优先', 9));

    const active = await api('/popup-ad/active');
    expect(active.status).toBe(200);
    const ids = active.body.data.ads.map((item: { id: string }) => item.id);
    expect(ids.indexOf(high.id)).toBeLessThan(ids.indexOf(low.id));
    expect(active.body.data.serverDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const off = await api(`/admin/popup-ads/${high.id}/enabled`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    }, admin);
    expect(off.status).toBe(200);

    const after = await api('/popup-ad/active');
    const afterIds = after.body.data.ads.map((item: { id: string }) => item.id);
    expect(afterIds).toContain(low.id);
    expect(afterIds).not.toContain(high.id);
  });

  it('未开始 / 已结束的广告不下发', async () => {
    const future = await createAd({
      ...baseAd('契约未开始', 5),
      startAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    const ended = await createAd({
      ...baseAd('契约已结束', 5),
      endAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });

    const active = await api('/popup-ad/active');
    const ids = active.body.data.ads.map((item: { id: string }) => item.id);
    expect(ids).not.toContain(future.id);
    expect(ids).not.toContain(ended.id);
  });
});

describe('弹窗广告：校验', () => {
  it('图片必须来自素材库，链接必须有效', async () => {
    const external = await api('/admin/popup-ads', {
      method: 'POST',
      body: JSON.stringify({
        ...baseAd('外链图片', 1),
        imageKey: 'https://example.com/ad.jpg',
      }),
    }, admin);
    expect(external.status).toBe(400);

    const badLink = await api('/admin/popup-ads', {
      method: 'POST',
      body: JSON.stringify({
        ...baseAd('失效商品', 1),
        link: { type: 'product', value: 'not-exist' },
      }),
    }, admin);
    expect(badLink.status).toBe(400);

    const emptyName = await api('/admin/popup-ads', {
      method: 'POST',
      body: JSON.stringify({ ...baseAd('', 1) }),
    }, admin);
    expect(emptyName.status).toBe(400);
  });

  it('时间区间倒置被拒绝', async () => {
    const res = await api('/admin/popup-ads', {
      method: 'POST',
      body: JSON.stringify({
        ...baseAd('时间倒置', 1),
        startAt: new Date(Date.now() + 86400000).toISOString(),
        endAt: new Date(Date.now() - 86400000).toISOString(),
      }),
    }, admin);
    expect(res.status).toBe(400);
  });
});
