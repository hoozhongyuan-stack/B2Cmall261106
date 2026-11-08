import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const ADMIN = 'http://127.0.0.1:5173';
const H5 = 'http://127.0.0.1:8080';
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

async function loginMiniapp(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/auth/wechat-login`, {
    data: { code: 'dev_miniapp_user' },
  });
  expect(res.ok(), `小程序登录失败：${res.status()}`).toBeTruthy();
  return unwrap<{ token: string }>(await res.json()).token;
}

/** 选一个非秒杀、有库存的 SKU，避免秒杀限购影响自提主链路 */
async function firstSku(
  request: APIRequestContext,
): Promise<{ productId: string; skuId: string }> {
  const products = await request.get(`${API}/products?page=1&pageSize=20`);
  const items = unwrap<{ items: { id: string }[] }>(await products.json()).items;
  for (const item of items) {
    const detail = await request.get(`${API}/products/${item.id}`);
    const data = unwrap<{
      skus: { id: string; available: number; status: string; seckill?: unknown }[];
    }>(await detail.json());
    const usable = data.skus.find(
      (sku) => sku.available > 0 && sku.status === 'ON_SALE' && !sku.seckill,
    );
    if (usable) return { productId: item.id, skuId: usable.id };
  }
  throw new Error('没有可用于自提测试的普通商品，请先执行 pnpm db:seed');
}

/** 建一个全周 08:00-23:00 营业的自提门店并铺库存，保证任意时间都有可自提时段 */
async function createPickupStore(
  request: APIRequestContext,
  token: string,
  skuId: string,
): Promise<{ id: string; name: string }> {
  const suffix = Date.now().toString(36).toUpperCase();
  const hours = Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, [['08:00', '23:00']]]),
  );
  const storeRes = await request.post(`${API}/admin/stores`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      code: `PK${suffix}`,
      name: `自提门店 ${suffix}`,
      phone: '13800005555',
      region: '云南省昆明市五华区',
      address: 'E2E 自提路 9 号',
      pickupEnabled: true,
      pickupCompleteDays: 7,
      businessHours: hours,
    },
  });
  expect(storeRes.ok(), await storeRes.text()).toBeTruthy();
  const store = unwrap<{ id: string; name: string }>(await storeRes.json());

  const stock = await request.post(`${API}/admin/stores/${store.id}/skus/batch`, {
    headers: { authorization: `Bearer ${token}` },
    data: { items: [{ skuId, stock: 5 }] },
  });
  expect(stock.ok()).toBeTruthy();
  return store;
}

async function loginAdmin(page: Page): Promise<void> {
  await page.goto(`${ADMIN}/login`);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(`${ADMIN}/`);
}

test('自提：小程序展示核销码，后台核销后订单完成', async ({ page, request }) => {
  const token = await adminToken(request);
  const userToken = await loginMiniapp(request);
  const { skuId } = await firstSku(request);
  const store = await createPickupStore(request, token, skuId);

  const created = await request.post(`${API}/orders`, {
    headers: {
      authorization: `Bearer ${userToken}`,
      'idempotency-key': `e2e-pickup-${Date.now()}`,
    },
    data: {
      items: [{ skuId, quantity: 1 }],
      fulfillmentType: 'PICKUP',
      storeId: store.id,
      pickupSlot: '10:00-12:00',
      contactPhone: '13900006666',
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const orderId = unwrap<{ id: string }>(await created.json()).id;

  const pay = await request.post(`${API}/orders/${orderId}/pay`, {
    headers: { authorization: `Bearer ${userToken}` },
  });
  expect(pay.ok()).toBeTruthy();
  const outTradeNo = unwrap<{ outTradeNo: string }>(await pay.json()).outTradeNo;
  const confirmed = await request.post(`${API}/payments/mock/confirm`, {
    headers: { authorization: `Bearer ${userToken}` },
    data: { outTradeNo },
  });
  expect(confirmed.ok()).toBeTruthy();

  const detail = await request.get(`${API}/orders/${orderId}`, {
    headers: { authorization: `Bearer ${userToken}` },
  });
  const order = unwrap<{ pickupCode: string; status: string }>(await detail.json());
  expect(order.status).toBe('PAID');
  expect(order.pickupCode).toMatch(/^\d{8}$/);

  // 小程序订单详情：核销码、门店与待自提状态
  await page.goto(`${H5}/#/pages/order-detail/index?id=${orderId}`);
  await expect(page.getByText('自提核销码')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(order.pickupCode)).toBeVisible();
  await expect(page.getByText('自提门店', { exact: true })).toBeVisible();
  await expect(page.getByText(store.name)).toBeVisible();
  await expect(page.getByText('待自提')).toBeVisible();

  // 后台核销台：输入核销码完成核销
  await loginAdmin(page);
  await page.goto(`${ADMIN}/fulfillment/pickups`);
  await expect(page.getByRole('heading', { name: '自提核销' })).toBeVisible();
  await page.getByPlaceholder('8 位核销码').fill(order.pickupCode);
  await page.locator('form').getByRole('button', { name: '核销' }).click();
  await expect(page.getByText('核销成功')).toBeVisible();

  await page.getByLabel('核销状态').selectOption('verified');
  await expect(page.locator('tr', { hasText: '人工核销' }).first()).toBeVisible();

  // 订单详情已完成且记录核销人
  const after = await request.get(`${API}/orders/${orderId}`, {
    headers: { authorization: `Bearer ${userToken}` },
  });
  const done = unwrap<{
    status: string;
    pickupVerification: { method: string } | null;
  }>(await after.json());
  expect(done.status).toBe('COMPLETED');
  expect(done.pickupVerification?.method).toBe('CODE');
});

test('H5 结算：切换到店自提、选择门店与时段，支付后展示核销码', async ({ page, request }) => {
  const token = await adminToken(request);
  const { productId, skuId } = await firstSku(request);
  const store = await createPickupStore(request, token, skuId);

  await page.goto(`${H5}/#/pages/product/index?id=${productId}`);
  await expect(page.getByText('立即购买')).toBeVisible();
  await page.getByText('立即购买').click();
  await expect(page).toHaveURL(/pages\/checkout\/index/);

  // 切换到店自提：自动进入门店选择页
  await page.getByText('到店自提', { exact: true }).click();
  await expect(page).toHaveURL(/pages\/store\/list\/index/);
  await expect(page.getByText(store.name, { exact: true })).toBeVisible();
  await page.getByText(store.name, { exact: true }).click();

  // 回到结算页：门店已带入，选择自提时段
  await expect(page.getByText('自提时段')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(store.name)).toBeVisible();
  const slot = page.locator('.checkout-slot').first();
  await expect(slot).toBeVisible();
  await slot.click();
  await expect(slot).toHaveClass(/checkout-slot--on/);

  await page.getByText('提交订单').click();
  await expect(page.getByText('支付成功')).toBeVisible({ timeout: 45_000 });
  await page.getByText('查看订单').click();

  // 订单详情展示核销码与待自提状态
  await expect(page.getByText('自提核销码')).toBeVisible();
  await expect(page.locator('.od-code')).toHaveText(/^\d{8}$/);
  await expect(page.getByText('待自提')).toBeVisible();
});
