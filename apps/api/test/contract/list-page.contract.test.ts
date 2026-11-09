/**
 * 列表页改造契约测试：分页元信息、关键词检索、批量操作。
 * 覆盖：商品、门店、评价、配送、自提、素材、优惠券。
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

let superToken = '';

/** 1x1 PNG，用于素材批量删除契约测试 */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

async function api(path: string, init: RequestInit = {}, token = superToken) {
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

function storeBody(code: string, name: string) {
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
    deliverySlots: ['10:00-12:00'],
    deliveryCutoff: '18:00',
    maxOrdersPerSlot: 20,
    pickupCompleteDays: 7,
    deliveryRegions: ['云南省昆明市五华区'],
  };
}

beforeAll(async () => {
  const admin = await api(
    '/admin/auth/login',
    { method: 'POST', body: JSON.stringify({ account: 'admin@shanye.com', password: 'admin123' }) },
    '',
  );
  superToken = admin.body.data.token;
});

afterAll(() => {
  superToken = '';
});

describe('商品列表分页与批量操作', () => {
  it('分页返回 total/page/pageSize，批量下架并删除后清空', async () => {
    const stamp = Date.now();
    const keyword = `列表分页${stamp}`;

    const category = await api('/admin/categories', {
      method: 'POST',
      body: JSON.stringify({ name: `分页分类${stamp}` }),
    });
    expect(category.status).toBe(201);
    const categoryId = category.body.data.id;

    const ids: string[] = [];
    for (const suffix of ['甲', '乙']) {
      const created = await api('/admin/products', {
        method: 'POST',
        body: JSON.stringify({
          title: `${keyword}${suffix}`,
          categoryId,
          status: 'ON_SALE',
          skus: [{ specJson: { 规格: '单件' }, priceCents: 1000, stock: 5 }],
        }),
      });
      expect(created.status).toBe(201);
      ids.push(created.body.data.id);
    }

    const first = await api(
      `/admin/products?keyword=${encodeURIComponent(keyword)}&page=1&pageSize=1`,
    );
    expect(first.status).toBe(200);
    expect(first.body.data.total).toBe(2);
    expect(first.body.data.page).toBe(1);
    expect(first.body.data.pageSize).toBe(1);
    expect(first.body.data.items).toHaveLength(1);

    const second = await api(
      `/admin/products?keyword=${encodeURIComponent(keyword)}&page=2&pageSize=1`,
    );
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.items[0].id).not.toBe(first.body.data.items[0].id);

    const offShelf = await api('/admin/products/batch/status', {
      method: 'PATCH',
      body: JSON.stringify({ ids, status: 'OFF_SHELF' }),
    });
    expect(offShelf.status).toBe(200);
    expect(offShelf.body.data).toMatchObject({ total: 2, success: 2, failed: 0 });

    const removed = await api('/admin/products/batch/delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ total: 2, success: 2, failed: 0 });

    const empty = await api(`/admin/products?keyword=${encodeURIComponent(keyword)}`);
    expect(empty.body.data.total).toBe(0);

    await api(`/admin/categories/${categoryId}`, { method: 'DELETE' });
  });

  it('批量参数为空时返回 400', async () => {
    const res = await api('/admin/products/batch/status', {
      method: 'PATCH',
      body: JSON.stringify({ ids: [], status: 'ON_SALE' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('门店列表检索、分页与批量启停', () => {
  it('关键词命中、分页裁剪、批量停用', async () => {
    const stamp = Date.now().toString(36).toUpperCase();
    const prefix = `列表分页门店${stamp}`;
    const ids: string[] = [];

    for (const suffix of ['一', '二']) {
      const created = await api('/admin/stores', {
        method: 'POST',
        body: JSON.stringify(storeBody(`LS${stamp}${suffix === '一' ? '1' : '2'}`, `${prefix}${suffix}`)),
      });
      expect(created.status).toBe(201);
      ids.push(created.body.data.id);
    }

    const page = await api(
      `/admin/stores?keyword=${encodeURIComponent(prefix)}&page=1&pageSize=1`,
    );
    expect(page.status).toBe(200);
    expect(page.body.data.total).toBe(2);
    expect(page.body.data.page).toBe(1);
    expect(page.body.data.items).toHaveLength(1);

    const disabled = await api('/admin/stores/batch/status', {
      method: 'POST',
      body: JSON.stringify({ ids, status: 'DISABLED' }),
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data).toMatchObject({ total: 2, success: 2, failed: 0 });

    const filtered = await api(
      `/admin/stores?keyword=${encodeURIComponent(prefix)}&status=DISABLED`,
    );
    expect(filtered.body.data.total).toBe(2);

    for (const id of ids) {
      await api(`/admin/stores/${id}`, { method: 'DELETE' });
    }
  });
});

describe('其余列表页分页与批量契约', () => {
  it('评价批量审核对不存在的 id 返回失败计数', async () => {
    const res = await api('/admin/reviews/batch/moderate', {
      method: 'POST',
      body: JSON.stringify({ ids: [randomUUID()], action: 'show' }),
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 1, success: 0, failed: 1 });
  });

  it('素材批量删除', async () => {
    const form = new FormData();
    form.append('files', new Blob([PNG_1PX], { type: 'image/png' }), `list-${randomUUID()}.png`);
    const uploaded = await fetch(`${BASE}/admin/assets/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${superToken}` },
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const asset = (await uploaded.json()).data.items[0] as { id: string };

    const removed = await api('/admin/assets/batch/delete', {
      method: 'POST',
      body: JSON.stringify({ ids: [asset.id] }),
    });
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ total: 1, success: 1, failed: 0 });
  });

  it('配送 / 自提 / 优惠券列表返回分页元信息', async () => {
    const deliveries = await api('/admin/deliveries?page=1&pageSize=1');
    expect(deliveries.status).toBe(200);
    expect(deliveries.body.data).toMatchObject({ page: 1, pageSize: 1 });
    expect(Array.isArray(deliveries.body.data.items)).toBe(true);

    const pickups = await api('/admin/pickups?status=pending&page=1&pageSize=1');
    expect(pickups.status).toBe(200);
    expect(pickups.body.data).toMatchObject({ page: 1, pageSize: 1 });

    const stamp = Date.now();
    const coupon = await api('/admin/coupons', {
      method: 'POST',
      body: JSON.stringify({
        name: `列表分页券${stamp}`,
        thresholdCents: 0,
        faceValueCents: 500,
        total: 10,
        startAt: new Date(stamp - 60_000).toISOString(),
        endAt: new Date(stamp + 86_400_000).toISOString(),
      }),
    });
    expect(coupon.status).toBe(201);

    const coupons = await api('/admin/coupons?page=1&pageSize=1');
    expect(coupons.status).toBe(200);
    expect(coupons.body.data).toMatchObject({ page: 1, pageSize: 1 });
    expect(coupons.body.data.total).toBeGreaterThan(0);
    expect(coupons.body.data.items).toHaveLength(1);
  });
});
