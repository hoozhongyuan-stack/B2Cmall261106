import { expect, test, type APIRequestContext } from '@playwright/test';

const ADMIN = 'http://127.0.0.1:5173';
const API = 'http://127.0.0.1:3000/api';

interface Envelope<T> {
  code: string;
  data: T;
}

function unwrap<T>(body: unknown): T {
  return (body as Envelope<T>).data;
}

async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/admin/auth/login`, {
    data: { account: 'admin@shanye.com', password: 'admin123' },
  });
  expect(res.ok(), `管理员登录失败：${res.status()}`).toBeTruthy();
  return unwrap<{ token: string }>(await res.json()).token;
}

async function createStore(
  request: APIRequestContext,
  token: string,
  input: { code: string; name: string; region: string },
): Promise<{ id: string; name: string }> {
  const res = await request.post(`${API}/admin/stores`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      ...input,
      address: 'E2E 测试路 1 号',
      pickupEnabled: true,
      deliveryEnabled: true,
      deliveryFeeCents: 500,
      freeDeliveryThresholdCents: 9900,
      deliverySlots: ['10:00-12:00'],
      deliveryCutoff: '18:00',
      pickupCompleteDays: 7,
      deliveryRegions: [input.region],
    },
  });
  expect(res.ok(), `创建门店失败：${res.status()} ${await res.text()}`).toBeTruthy();
  return unwrap<{ id: string; name: string }>(await res.json());
}

async function firstSku(request: APIRequestContext): Promise<{ id: string; title: string }> {
  const products = await request.get(`${API}/products?page=1&pageSize=1`);
  const productId = unwrap<{ items: { id: string }[] }>(await products.json()).items[0]?.id;
  expect(productId).toBeTruthy();
  const detail = await request.get(`${API}/products/${productId}`);
  const sku = unwrap<{ skus: { id: string }[]; title: string }>(await detail.json());
  return { id: sku.skus[0].id, title: sku.title };
}

async function loginAdmin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${ADMIN}/login`);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(`${ADMIN}/`);
}

test('门店管理：列表、库存弹窗与看板弹窗', async ({ page, request }) => {
  const token = await adminToken(request);
  const suffix = Date.now().toString(36).toUpperCase();
  const store = await createStore(request, token, {
    code: `E2E${suffix}`,
    name: `E2E 门店 ${suffix}`,
    region: '云南省昆明市五华区',
  });
  const sku = await firstSku(request);

  const stock = await request.post(`${API}/admin/stores/${store.id}/skus/batch`, {
    headers: { authorization: `Bearer ${token}` },
    data: { items: [{ skuId: sku.id, stock: 10, safetyStock: 20 }] },
  });
  expect(stock.ok()).toBeTruthy();

  await loginAdmin(page);
  await page.goto(`${ADMIN}/settings/stores`);
  await expect(page.getByRole('heading', { name: '门店管理' })).toBeVisible();

  const row = page.locator('tr', { hasText: store.name });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: '看板' }).click();
  const dashboard = page.locator('.modal');
  await expect(dashboard.getByText('门店看板')).toBeVisible();
  await expect(dashboard.getByText('今日支付订单')).toBeVisible();
  await expect(dashboard.getByText('库存预警').first()).toBeVisible();
  await expect(dashboard.getByText('平均接单时长')).toBeVisible();
  await expect(dashboard.getByText('平均送达时长')).toBeVisible();
  await expect(dashboard.getByText('超时配送单')).toBeVisible();
  await expect(dashboard.getByText(sku.title).first()).toBeVisible();
  await dashboard.locator('.modal-ft').getByRole('button', { name: '关闭' }).click();

  await row.getByRole('button', { name: '库存' }).click();
  const stockModal = page.locator('.modal');
  await expect(stockModal.getByText(`门店库存`)).toBeVisible();
  await expect(stockModal.getByRole('button', { name: '添加商品' })).toBeVisible();
  await expect(stockModal.getByRole('button', { name: '库存流水' })).toBeVisible();
  await expect(stockModal.locator('input[type="number"]').first()).toHaveValue('10');
});

test('门店账号：只看到授权门店', async ({ page, request }) => {
  const token = await adminToken(request);
  const suffix = Date.now().toString(36).toUpperCase();
  const first = await createStore(request, token, {
    code: `EA${suffix}`,
    name: `授权门店 ${suffix}`,
    region: '云南省昆明市五华区',
  });
  const second = await createStore(request, token, {
    code: `EB${suffix}`,
    name: `未授权门店 ${suffix}`,
    region: '云南省昆明市盘龙区',
  });

  const account = `store-${Date.now()}@shanye.com`;
  const password = 'store12345';
  const created = await request.post(`${API}/admin/accounts`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      account,
      displayName: 'E2E 门店账号',
      role: 'STORE',
      password,
      storeIds: [first.id],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();

  await page.goto(`${ADMIN}/login`);
  await page.getByPlaceholder('请输入登录账号').fill(account);
  await page.getByPlaceholder('请输入密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(`${ADMIN}/orders`);

  const options = await page.locator('.topbar select').first().locator('option').allTextContents();
  expect(options).toContain(first.name);
  expect(options).not.toContain(second.name);

  await page.goto(`${ADMIN}/settings/stores`);
  await expect(page.getByRole('heading', { name: '门店管理' })).toBeVisible();
  await expect(page.locator('tr', { hasText: first.name })).toBeVisible();
  await expect(page.locator('tr', { hasText: second.name })).toHaveCount(0);
});
