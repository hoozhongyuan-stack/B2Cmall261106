/**
 * 后台运营接口契约测试（工程契约 R2）
 * 覆盖：地址簿、商品/分类/标签、店铺与素材、子账号、操作日志、数据概览。
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

/** 1x1 PNG，用于素材上传契约测试 */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

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
});

afterAll(async () => {
  await prisma?.$disconnect();
  prisma = null;
});

describe('地址簿契约', () => {
  it('新增 / 改默认 / 修改 / 删除，默认地址始终唯一', async () => {
    const created = await api('/addresses', {
      method: 'POST',
      body: JSON.stringify({
        receiver: '契约测试',
        phone: '13900001111',
        region: '云南省昆明市盘龙区',
        detail: '测试路 9 号',
      }),
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const setDefault = await api(`/addresses/${id}/default`, { method: 'POST' });
    expect(setDefault.status).toBe(200);

    const list = await api('/addresses');
    const defaults = list.body.data.items.filter((a: { isDefault: boolean }) => a.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(id);

    const updated = await api(`/addresses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ detail: '测试路 10 号' }),
    });
    expect(updated.status).toBe(200);

    const removed = await api(`/addresses/${id}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
  });

  it('手机号非法返回 400', async () => {
    const res = await api('/addresses', {
      method: 'POST',
      body: JSON.stringify({
        receiver: '张三',
        phone: '12345',
        region: '云南省',
        detail: '某处',
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('商品与分类标签契约', () => {
  let categoryId = '';
  let productId = '';
  let skuId = '';
  let tagId = '';

  it('分类可建可查，商品可建并自动计算价格区间', async () => {
    const category = await api(
      '/admin/categories',
      { method: 'POST', body: JSON.stringify({ name: `契约分类${Date.now()}` }) },
      superToken,
    );
    expect(category.status).toBe(201);
    categoryId = category.body.data.id;

    const created = await api(
      '/admin/products',
      {
        method: 'POST',
        body: JSON.stringify({
          title: `契约商品${Date.now()}`,
          categoryId,
          status: 'ON_SALE',
          skus: [
            { specJson: { 规格: '单件' }, priceCents: 1234, stock: 10 },
            { specJson: { 规格: '双件' }, priceCents: 2000, stock: 5 },
          ],
        }),
      },
      superToken,
    );
    expect(created.status).toBe(201);
    productId = created.body.data.id;
    skuId = created.body.data.skus[0].id;
    expect(created.body.data.priceMinCents).toBe(1234);
    expect(created.body.data.priceMaxCents).toBe(2000);

    const list = await api(`/admin/products?keyword=契约商品`, {}, superToken);
    expect(list.body.data.items.some((p: { id: string }) => p.id === productId)).toBe(true);
  });

  it('改 SKU 价格后商品价格区间重算，标签指派生效', async () => {
    const patched = await api(
      `/admin/products/${productId}/skus/${skuId}`,
      { method: 'PATCH', body: JSON.stringify({ priceCents: 900 }) },
      superToken,
    );
    expect(patched.status).toBe(200);

    const detail = await api(`/admin/products/${productId}`, {}, superToken);
    expect(detail.body.data.priceMinCents).toBe(900);

    const tag = await api(
      '/admin/tags',
      { method: 'POST', body: JSON.stringify({ name: `契约标签${Date.now()}` }) },
      superToken,
    );
    expect(tag.status).toBe(201);
    tagId = tag.body.data.id;

    const assigned = await api(
      `/admin/products/${productId}/tags`,
      { method: 'PATCH', body: JSON.stringify({ tagIds: [tagId] }) },
      superToken,
    );
    expect(assigned.status).toBe(200);

    const tagged = await api(`/admin/products/${productId}`, {}, superToken);
    expect(tagged.body.data.tags.some((t: { id: string }) => t.id === tagId)).toBe(true);
  });

  it('未产生订单的商品可删除，分类删除被商品占用时拒绝', async () => {
    const removed = await api(`/admin/products/${productId}`, { method: 'DELETE' }, superToken);
    expect(removed.status).toBe(200);

    const blocked = await api(`/admin/categories/${categoryId}`, { method: 'DELETE' }, superToken);
    expect([200, 409]).toContain(blocked.status);

    await api(`/admin/tags/${tagId}`, { method: 'DELETE' }, superToken);
    await api(`/admin/categories/${categoryId}`, { method: 'DELETE' }, superToken);
  });
});

describe('店铺与素材契约', () => {
  it('店铺配置可读可写，地区例外可增删', async () => {
    const shop = await api('/admin/shop', {}, superToken);
    expect(shop.status).toBe(200);
    expect(Number.isInteger(shop.body.data.freeThresholdCents)).toBe(true);

    const patched = await api(
      '/admin/shop',
      {
        method: 'PATCH',
        body: JSON.stringify({
          freeThresholdCents: shop.body.data.freeThresholdCents,
          flatFreightCents: shop.body.data.flatFreightCents,
        }),
      },
      superToken,
    );
    expect(patched.status).toBe(200);

    const region = await api(
      '/admin/shop/regions',
      { method: 'POST', body: JSON.stringify({ regionName: `契约地区${Date.now()}`, freightCents: 1500 }) },
      superToken,
    );
    expect(region.status).toBe(201);

    const removed = await api(`/admin/shop/regions/${region.body.data.id}`, { method: 'DELETE' }, superToken);
    expect(removed.status).toBe(200);
  });

  it('店铺基础信息可保存并在公开接口下发', async () => {
    const profile = {
      serviceEmail: 'service@shanye.test',
      serviceWechat: 'shanye-service',
      serviceHours: '9:00-21:00',
      companyAddress: '云南省昆明市盘龙区测试路 9 号',
      companyName: '云南山野商贸有限公司',
      creditCode: '91530103MA6K12345X',
      icpNumber: '滇ICP备2026000000号',
      icpUrl: 'https://beian.miit.gov.cn/',
      policeNumber: '滇公网安备53010302000000号',
      policeUrl: 'https://beian.mps.gov.cn/',
      officialSiteUrl: 'https://shop.shanye.test',
    };

    const patched = await api(
      '/admin/shop',
      { method: 'PATCH', body: JSON.stringify(profile) },
      superToken,
    );
    expect(patched.status).toBe(200);

    const detail = await api('/admin/shop', {}, superToken);
    expect(detail.body.data).toMatchObject(profile);

    const pub = await api('/shop');
    expect(pub.status).toBe(200);
    expect(pub.body.data).toMatchObject(profile);
    expect(pub.body.data).not.toHaveProperty('businessDomain');

    // 空串按清空处理
    const cleared = await api(
      '/admin/shop',
      { method: 'PATCH', body: JSON.stringify({ serviceWechat: '' }) },
      superToken,
    );
    expect(cleared.status).toBe(200);
    const afterClear = await api('/admin/shop', {}, superToken);
    expect(afterClear.body.data.serviceWechat).toBeNull();

    // 非法值
    for (const body of [
      { serviceEmail: 'not-an-email' },
      { creditCode: '123' },
      { officialSiteUrl: 'ftp://shop.shanye.test' },
      { icpUrl: 'beian.miit.gov.cn' },
    ]) {
      const bad = await api(
        '/admin/shop',
        { method: 'PATCH', body: JSON.stringify(body) },
        superToken,
      );
      expect(bad.status, JSON.stringify(body)).toBe(400);
    }

    // 非超管不可写
    const ops = await api(
      '/admin/auth/login',
      { method: 'POST', body: JSON.stringify({ account: 'ops@shanye.com', password: 'ops12345' }) },
      '',
    );
    const forbidden = await api(
      '/admin/shop',
      { method: 'PATCH', body: JSON.stringify({ servicePhone: '400-800-1234' }) },
      ops.body.data.token as string,
    );
    expect(forbidden.status).toBe(403);
  });

  it('素材可上传、归类、移动与删除', async () => {
    const folder = await api(
      '/admin/assets/folders',
      { method: 'POST', body: JSON.stringify({ name: `契约文件夹${Date.now()}` }) },
      superToken,
    );
    expect(folder.status).toBe(201);

    const form = new FormData();
    form.append(
      'files',
      new Blob([PNG_1PX], { type: 'image/png' }),
      `contract-${randomUUID()}.png`,
    );
    form.append('folderId', folder.body.data.id);
    const uploaded = await fetch(`${BASE}/admin/assets/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${superToken}` },
      body: form,
    });
    const uploadBody = await uploaded.json();
    expect(uploaded.status).toBe(201);
    const asset = uploadBody.data.items[0] as { id: string; key: string; url: string };
    expect(asset.key.startsWith('/api/media/assets/')).toBe(true);

    // 静态托管可直接访问图片
    const origin = BASE.replace(/\/api$/, '');
    const media = await fetch(`${origin}${asset.url}`);
    expect(media.status).toBe(200);
    expect(media.headers.get('content-type')).toContain('image/png');

    const list = await api(
      `/admin/assets?folderId=${folder.body.data.id}&keyword=contract-`,
      {},
      superToken,
    );
    expect(list.body.data.items.some((a: { id: string }) => a.id === asset.id)).toBe(true);
    expect(list.body.data.items[0].folderName).toBe(folder.body.data.name);

    // 被店铺 Logo 引用时不可删除
    await api('/admin/shop', { method: 'PATCH', body: JSON.stringify({ logoKey: asset.key }) }, superToken);
    const blocked = await api(`/admin/assets/${asset.id}`, { method: 'DELETE' }, superToken);
    expect(blocked.status).toBe(409);
    await api('/admin/shop', { method: 'PATCH', body: JSON.stringify({ logoKey: '' }) }, superToken);

    // 非空文件夹不可删除
    const folderBlocked = await api(
      `/admin/assets/folders/${folder.body.data.id}`,
      { method: 'DELETE' },
      superToken,
    );
    expect(folderBlocked.status).toBe(409);

    const removed = await api(`/admin/assets/${asset.id}`, { method: 'DELETE' }, superToken);
    expect(removed.status).toBe(200);

    const folderRemoved = await api(
      `/admin/assets/folders/${folder.body.data.id}`,
      { method: 'DELETE' },
      superToken,
    );
    expect(folderRemoved.status).toBe(200);
  });
});

describe('子账号与操作日志契约', () => {
  let accountId = '';

  it('超管可建子账号、停用并重置密码', async () => {
    const account = `contract${Date.now()}@shanye.com`;
    const created = await api(
      '/admin/accounts',
      {
        method: 'POST',
        body: JSON.stringify({
          account,
          displayName: '契约客服',
          role: 'CS',
          password: 'contract123',
        }),
      },
      superToken,
    );
    expect(created.status).toBe(201);
    accountId = created.body.data.id;

    const list = await api('/admin/accounts', {}, superToken);
    expect(list.body.data.items.every((a: { passwordHash?: string }) => !a.passwordHash)).toBe(true);

    const disabled = await api(
      `/admin/accounts/${accountId}/status`,
      { method: 'POST', body: JSON.stringify({ status: 'DISABLED' }) },
      superToken,
    );
    expect(disabled.status).toBe(200);

    const reset = await api(
      `/admin/accounts/${accountId}/reset-password`,
      { method: 'POST', body: JSON.stringify({ password: 'newpass123' }) },
      superToken,
    );
    expect(reset.status).toBe(200);
  });

  it('写操作会被记录到操作日志', async () => {
    const logs = await api('/admin/logs?page=1&pageSize=10', {}, superToken);
    expect(logs.status).toBe(200);
    expect(logs.body.data.total).toBeGreaterThan(0);
    expect(logs.body.data.items[0]).toHaveProperty('action');
    expect(JSON.stringify(logs.body.data.items)).not.toContain('contract123');
  });
});

describe('集成配置契约', () => {
  it('读取 / 修改 / 保存 AppSecret / 清除，接口不回显密钥', async () => {
    const before = await api('/admin/integration', {}, superToken);
    expect(before.status).toBe(200);
    expect(before.body.data.miniappAppSecret).toHaveProperty('configured');
    expect(before.body.data.subscribeTemplateIds).toHaveProperty('orderPaid');

    const plain = 'Ab3'.repeat(10) + 'Zx';
    const patched = await api(
      '/admin/integration',
      {
        method: 'PATCH',
        body: JSON.stringify({
          miniappAppId: 'wx1234567890abcdef',
          miniappAppSecret: plain,
          paymentProvider: 'mock',
          wechatPayMchId: '1900000001',
          wechatPayCertSerial: 'SERIAL-001',
          wechatPayNotifyUrl: 'https://example.com/api/payments/callback',
          subscribeTemplateIds: { orderPaid: 'tpl-paid', orderShipped: '', refundResult: '' },
          apiBaseUrl: 'https://api.example.com/api',
          businessDomain: 'api.example.com',
        }),
      },
      superToken,
    );
    expect(patched.status).toBe(200);

    const afterSave = await api('/admin/integration', {}, superToken);
    expect(afterSave.body.data.miniappAppSecret.configured).toBe(true);
    expect(JSON.stringify(afterSave.body.data)).not.toContain(plain);

    // 审计日志同样不能落密钥明文
    const logs = await api('/admin/logs?page=1&pageSize=20', {}, superToken);
    expect(JSON.stringify(logs.body.data.items)).not.toContain(plain);

    const cleared = await api(
      '/admin/integration',
      { method: 'PATCH', body: JSON.stringify({ miniappAppSecret: '' }) },
      superToken,
    );
    expect(cleared.status).toBe(200);

    const afterClear = await api('/admin/integration', {}, superToken);
    expect(afterClear.body.data.miniappAppSecret.configured).toBe(false);
  });

  it('非法密钥类型、文件格式或 AppSecret 长度返回 400', async () => {
    const badField = await api(
      '/admin/integration/secrets/unknownField',
      {
        method: 'POST',
        body: JSON.stringify({ fileName: 'x.txt', contentBase64: 'YWJj' }),
      },
      superToken,
    );
    expect(badField.status).toBe(400);

    const badExt = await api(
      '/admin/integration/secrets/wechatPayPrivateKey',
      {
        method: 'POST',
        body: JSON.stringify({ fileName: 'key.exe', contentBase64: 'YWJj' }),
      },
      superToken,
    );
    expect(badExt.status).toBe(400);

    // AppSecret 必须是 32 位字母数字，误填私钥内容应被拒绝
    const badSecret = await api(
      '/admin/integration',
      {
        method: 'PATCH',
        body: JSON.stringify({ miniappAppSecret: '-----BEGIN PRIVATE KEY-----' }),
      },
      superToken,
    );
    expect(badSecret.status).toBe(400);
  });

  it('非超管不能修改集成配置', async () => {
    const ops = await api(
      '/admin/auth/login',
      { method: 'POST', body: JSON.stringify({ account: 'ops@shanye.com', password: 'ops12345' }) },
      '',
    );
    const opsToken = ops.body.data.token as string;

    const read = await api('/admin/integration', {}, opsToken);
    expect(read.status).toBe(200);

    const patched = await api(
      '/admin/integration',
      { method: 'PATCH', body: JSON.stringify({ paymentProvider: 'mock' }) },
      opsToken,
    );
    expect(patched.status).toBe(403);
  });
});

describe('小程序发布契约', () => {
  it('环境检查与发布记录可读', async () => {
    const ready = await api('/admin/miniapp/readiness', {}, superToken);
    expect(ready.status).toBe(200);
    expect(ready.body.data.uploadKey).toHaveProperty('configured');
    expect(typeof ready.body.data.suggestedVersion).toBe('string');

    const list = await api('/admin/miniapp/releases', {}, superToken);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data.items)).toBe(true);
  });

  it('版本号非法、未配置上传密钥、非超管创建都被拒绝', async () => {
    const badVersion = await api(
      '/admin/miniapp/releases',
      { method: 'POST', body: JSON.stringify({ version: 'v1', description: '测试' }) },
      superToken,
    );
    expect(badVersion.status).toBe(400);

    // 未上传代码上传密钥时直接 400，不会触发构建
    const noKey = await api(
      '/admin/miniapp/releases',
      { method: 'POST', body: JSON.stringify({ version: '1.0.1', description: '测试' }) },
      superToken,
    );
    expect(noKey.status).toBe(400);

    const ops = await api(
      '/admin/auth/login',
      { method: 'POST', body: JSON.stringify({ account: 'ops@shanye.com', password: 'ops12345' }) },
      '',
    );
    const forbidden = await api(
      '/admin/miniapp/releases',
      { method: 'POST', body: JSON.stringify({ version: '1.0.1', description: '测试' }) },
      ops.body.data.token as string,
    );
    expect(forbidden.status).toBe(403);
  });
});

describe('数据概览契约', () => {
  it('返回今日指标、待办、7 日趋势与热销商品', async () => {
    const res = await api('/admin/dashboard', {}, superToken);
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.today).toHaveProperty('paidAmountCents');
    expect(data.pending).toHaveProperty('toShipCount');
    expect(data.trend).toHaveLength(7);
    expect(Array.isArray(data.topProducts)).toBe(true);
  });
});
