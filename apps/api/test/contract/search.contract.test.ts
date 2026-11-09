/**
 * 迭代 D 契约测试：全文搜索召回、筛选、排序、分页与搜索统计。
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGREEMENT_VERSIONS } from '@shanye/shared';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

let prisma: PrismaClient | null = null;
let superToken = '';
let userToken = '';
let searchUserId = '';
let categoryId = '';
let tagId = '';
let storeId = '';
let productA = '';
let productB = '';
let productC = '';
const createdProducts: string[] = [];

interface ProductPage {
  total: number;
  page: number;
  pageSize: number;
  items: { id: string; title: string; priceMinCents: number; soldCount: number }[];
}

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
  return `${prefix}${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
}

async function search(query: Record<string, string | number>, token = '') {
  const qs = Object.entries(query)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
  const res = await api(`/products?${qs}`, {}, token);
  expect(res.status).toBe(200);
  return res.body.data as ProductPage;
}

async function createProduct(input: {
  title: string;
  subtitle: string;
  priceCents: number;
  status: 'ON_SALE' | 'OFF_SHELF';
}): Promise<{ id: string; skuId: string }> {
  const res = await api(
    '/admin/products',
    {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        subtitle: input.subtitle,
        categoryId,
        status: input.status,
        skus: [
          {
            code: uniqueCode('SR'),
            specJson: { 规格: '500g' },
            priceCents: input.priceCents,
            stock: 20,
          },
        ],
      }),
    },
    superToken,
  );
  expect(res.status).toBe(201);
  createdProducts.push(res.body.data.id);
  return { id: res.body.data.id, skuId: res.body.data.skus[0].id };
}

beforeAll(async () => {
  prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });
  const suffix = uniqueCode('S');

  const admin = await api('/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account: 'admin@shanye.com', password: 'admin123' }),
  });
  superToken = admin.body.data.token;

  const login = await api('/auth/wechat-login', {
    method: 'POST',
    body: JSON.stringify({ code: `search_${suffix}`, agreed: true, agreementVersion: AGREEMENT_VERSIONS.terms, privacyVersion: AGREEMENT_VERSIONS.privacy }),
  });
  userToken = login.body.data.token;
  searchUserId = login.body.data.user.id;

  const category = await api(
    '/admin/categories',
    { method: 'POST', body: JSON.stringify({ name: `搜索契约分类${suffix}`, sort: 90 }) },
    superToken,
  );
  expect(category.status).toBe(201);
  categoryId = category.body.data.id;

  const a = await createProduct({
    title: `契约普洱甲${suffix}`,
    subtitle: '古树春茶',
    priceCents: 1000,
    status: 'ON_SALE',
  });
  const b = await createProduct({
    title: `契约咖啡乙${suffix}`,
    subtitle: '手冲单品',
    priceCents: 5000,
    status: 'ON_SALE',
  });
  const c = await createProduct({
    title: `契约下架丙${suffix}`,
    subtitle: '下架样本',
    priceCents: 3000,
    status: 'OFF_SHELF',
  });
  productA = a.id;
  productB = b.id;
  productC = c.id;

  const tag = await api(
    '/admin/tags',
    { method: 'POST', body: JSON.stringify({ name: `契约标签${suffix}` }) },
    superToken,
  );
  expect(tag.status).toBe(201);
  tagId = tag.body.data.id;
  const bound = await api(
    `/admin/products/${productA}/tags`,
    { method: 'PATCH', body: JSON.stringify({ tagIds: [tagId] }) },
    superToken,
  );
  expect(bound.status).toBe(200);

  await prisma.product.update({ where: { id: productA }, data: { soldCount: 1, createdAt: new Date(Date.now() - 60_000) } });
  await prisma.product.update({ where: { id: productB }, data: { soldCount: 50 } });

  const store = await prisma.store.create({
    data: {
      code: uniqueCode('SST'),
      name: '搜索契约门店',
      region: '云南省昆明市五华区',
      address: '测试路 9 号',
    },
  });
  storeId = store.id;
  await prisma.storeSku.create({ data: { storeId, skuId: a.skuId, stock: 10 } });
});

afterAll(async () => {
  if (prisma) {
    await prisma.storeSku.deleteMany({ where: { storeId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
    await prisma.productTag.deleteMany({ where: { id: tagId } });
    const skus = await prisma.sku.findMany({ where: { productId: { in: createdProducts } } });
    await prisma.sku.deleteMany({ where: { id: { in: skus.map((sku) => sku.id) } } });
    await prisma.product.deleteMany({ where: { id: { in: createdProducts } } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  }
  prisma = null;
});

describe('搜索契约', () => {
  it('中文两字召回，且只返回在售商品', async () => {
    const page = await search({ keyword: '契约', pageSize: 20 });
    const ids = page.items.map((item) => item.id);
    expect(page.total).toBe(2);
    expect(ids).toContain(productA);
    expect(ids).toContain(productB);
    expect(ids).not.toContain(productC);
    expect(Object.keys(page).sort()).toEqual(['items', 'page', 'pageSize', 'total']);
  });

  it('拼音全拼与首字母可召回', async () => {
    const full = await search({ keyword: 'qiyue', pageSize: 20 });
    expect(full.items.map((item) => item.id)).toContain(productA);

    const initials = await search({ keyword: 'qypej', pageSize: 20 });
    expect(initials.items.map((item) => item.id)).toContain(productA);
  });

  it('单字符降级 ILIKE，通配符被转义', async () => {
    const single = await search({ keyword: '契', pageSize: 20 });
    expect(single.total).toBe(2);

    const wildcard = await search({ keyword: '%', pageSize: 20 });
    expect(wildcard.total).toBe(0);
  });

  it('分类 / 价格 / 标签 / 门店筛选', async () => {
    const byCategory = await search({ categoryId, pageSize: 20 });
    expect(byCategory.total).toBe(2);

    const byPrice = await search({ keyword: '契约', priceMinCents: 2000, priceMaxCents: 6000 });
    expect(byPrice.items.map((item) => item.id)).toEqual([productB]);

    const byTag = await search({ tagId });
    expect(byTag.items.map((item) => item.id)).toEqual([productA]);

    const byStore = await search({ storeId });
    expect(byStore.items.map((item) => item.id)).toEqual([productA]);
  });

  it('销量 / 价格 / 新品排序与稳定分页', async () => {
    const sales = await search({ keyword: '契约', sort: 'sales' });
    expect(sales.items.map((item) => item.id)).toEqual([productB, productA]);

    const asc = await search({ keyword: '契约', sort: 'price_asc' });
    expect(asc.items.map((item) => item.id)).toEqual([productA, productB]);

    const desc = await search({ keyword: '契约', sort: 'price_desc' });
    expect(desc.items.map((item) => item.id)).toEqual([productB, productA]);

    const newest = await search({ keyword: '契约', sort: 'new' });
    expect(newest.items.map((item) => item.id)).toEqual([productB, productA]);

    const first = await search({ keyword: '契约', page: 1, pageSize: 1 });
    const second = await search({ keyword: '契约', page: 2, pageSize: 1 });
    expect(first.total).toBe(2);
    expect(second.total).toBe(2);
    expect(first.items[0].id).not.toBe(second.items[0].id);
  });

  it('非法参数返回 400', async () => {
    for (const query of [
      'sort=unknown',
      'priceMinCents=-1',
      'priceMinCents=abc',
      'priceMinCents=5000&priceMaxCents=1000',
    ]) {
      const res = await api(`/products?${query}`);
      expect(res.status, query).toBe(400);
    }
  });

  it('搜索日志、热词与后台统计', async () => {
    await search({ keyword: '契约热词' }, userToken);
    await search({ keyword: '契约热词' }, userToken);
    await search({ keyword: '契约' }, userToken);

    const logged = await prisma!.searchLog.findFirst({
      where: { keyword: '契约', userId: searchUserId },
      orderBy: { createdAt: 'desc' },
    });
    expect(logged?.resultCount).toBe(2);

    const hot = await api('/search/hot?limit=20');
    expect(hot.status).toBe(200);
    expect(hot.body.data).toContain('契约');
    expect(hot.body.data).not.toContain('契约热词');

    const stats = await api('/admin/search/stats?days=1&limit=20', {}, superToken);
    expect(stats.status).toBe(200);
    const top = stats.body.data.topKeywords as { keyword: string; count: number }[];
    const noResult = stats.body.data.noResultKeywords as { keyword: string; count: number }[];
    expect(top.find((row) => row.keyword === '契约热词')?.count).toBe(2);
    expect(noResult.some((row) => row.keyword === '契约热词')).toBe(true);

    const anonymous = await api('/admin/search/stats');
    expect(anonymous.status).toBe(401);
    const forbidden = await api('/admin/search/stats', {}, userToken);
    expect(forbidden.status).toBe(403);
  });
});
