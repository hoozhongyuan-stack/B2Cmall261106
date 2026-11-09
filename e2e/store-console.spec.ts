import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

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

/** 种子会员「王先生」已绑定手机号，可被关联为门店负责人 */
async function loginSeedMember(
  request: APIRequestContext,
): Promise<{ token: string; id: string; nickname: string }> {
  const res = await request.post(`${API}/auth/wechat-login`, { data: { code: 'seed_user' } });
  expect(res.ok(), `会员登录失败：${res.status()}`).toBeTruthy();
  const data = unwrap<{ token: string; user: { id: string; nickname: string } }>(await res.json());
  return { token: data.token, id: data.user.id, nickname: data.user.nickname };
}

async function findSku(request: APIRequestContext): Promise<string> {
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
    if (usable) return usable.id;
  }
  throw new Error('没有可售商品，请先执行 pnpm db:seed');
}

/** 同一会员只能关联一家门店，清理历史失败用例残留的绑定（门店可能超过一页） */
async function clearBinding(
  request: APIRequestContext,
  token: string,
  managerUserId: string,
): Promise<void> {
  const headers = { authorization: `Bearer ${token}` };
  let page = 1;
  for (;;) {
    const list = await request.get(`${API}/admin/stores?pageSize=100&page=${page}`, { headers });
    const data = unwrap<{
      total: number;
      items: { id: string; managerUserId: string | null }[];
    }>(await list.json());
    for (const item of data.items) {
      if (item.managerUserId === managerUserId) {
        await request.put(`${API}/admin/stores/${item.id}/manager`, {
          headers,
          data: { managerUserId: null },
        });
      }
    }
    if (page * 100 >= data.total) return;
    page += 1;
  }
}

async function injectToken(page: Page, token: string): Promise<void> {
  await page.addInitScript(
    (value) => localStorage.setItem('shanye_token', JSON.stringify({ data: value })),
    token,
  );
}

test('门店中心：关联会员的小程序个人中心可见入口，可工作台核销', async ({ page, request }) => {
  const token = await adminToken(request);
  const member = await loginSeedMember(request);
  const skuId = await findSku(request);
  const suffix = Date.now().toString(36).toUpperCase();

  await clearBinding(request, token, member.id);

  const hours = Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, [['08:00', '23:00']]]),
  );
  const storeRes = await request.post(`${API}/admin/stores`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      code: `CN${suffix}`,
      name: `门店中心 ${suffix}`,
      phone: '13800005555',
      region: '云南省昆明市五华区',
      address: 'E2E 门店中心路 8 号',
      pickupEnabled: true,
      pickupCompleteDays: 7,
      businessHours: hours,
      managerUserId: member.id,
    },
  });
  expect(storeRes.ok(), await storeRes.text()).toBeTruthy();
  const store = unwrap<{ id: string; name: string }>(await storeRes.json());

  const stock = await request.post(`${API}/admin/stores/${store.id}/skus/batch`, {
    headers: { authorization: `Bearer ${token}` },
    data: { items: [{ skuId, stock: 5 }] },
  });
  expect(stock.ok()).toBeTruthy();

  // 用同一会员下一笔自提单，工作台应有待核销
  const orderRes = await request.post(`${API}/orders`, {
    headers: {
      authorization: `Bearer ${member.token}`,
      'idempotency-key': `e2e-console-${Date.now()}`,
    },
    data: {
      items: [{ skuId, quantity: 1 }],
      fulfillmentType: 'PICKUP',
      storeId: store.id,
      pickupSlot: '10:00-12:00',
      contactPhone: '13900006666',
    },
  });
  expect(orderRes.ok(), await orderRes.text()).toBeTruthy();
  const orderId = unwrap<{ id: string }>(await orderRes.json()).id;

  const pay = await request.post(`${API}/orders/${orderId}/pay`, {
    headers: { authorization: `Bearer ${member.token}` },
  });
  expect(pay.ok()).toBeTruthy();
  const outTradeNo = unwrap<{ outTradeNo: string }>(await pay.json()).outTradeNo;
  const confirmed = await request.post(`${API}/payments/mock/confirm`, {
    headers: { authorization: `Bearer ${member.token}` },
    data: { outTradeNo },
  });
  expect(confirmed.ok()).toBeTruthy();

  const detail = await request.get(`${API}/orders/${orderId}`, {
    headers: { authorization: `Bearer ${member.token}` },
  });
  const pickupCode = unwrap<{ pickupCode: string | null }>(await detail.json()).pickupCode;
  expect(pickupCode).toMatch(/^\d{8}$/);

  await injectToken(page, member.token);

  // 个人中心出现「门店中心」入口，展示关联门店名
  await page.goto(`${H5}/#/pages/mine/index`);
  const entry = page.locator('.mine-store-entry');
  await expect(entry).toBeVisible({ timeout: 30_000 });
  await expect(entry).toContainText('门店中心');
  await expect(entry).toContainText(store.name);

  await entry.click();
  await expect(page).toHaveURL(/pages\/store-console\/index/);
  await expect(page.locator('.console-store')).toContainText(store.name);
  await expect(page.locator('.console-todo').first()).toContainText('1');

  // 待核销 → 核销页 → 输入核销码完成核销
  await page.locator('.console-todo').first().click();
  await expect(page).toHaveURL(/pages\/store-console\/verify/);
  await page.locator('.verify-input input').fill(pickupCode!);
  await page.getByText('确认核销', { exact: true }).click();
  await expect(page.getByText('核销成功')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.verify-order-no')).toBeVisible();

  const after = await request.get(`${API}/orders/${orderId}`, {
    headers: { authorization: `Bearer ${member.token}` },
  });
  expect(unwrap<{ status: string }>(await after.json()).status).toBe('COMPLETED');

  // 清理绑定，避免影响下次运行
  await request.put(`${API}/admin/stores/${store.id}/manager`, {
    headers: { authorization: `Bearer ${token}` },
    data: { managerUserId: null },
  });
});

test('门店中心：库存预警筛选、库存调整与营业设置', async ({ page, request }) => {
  const token = await adminToken(request);
  const member = await loginSeedMember(request);
  const skuId = await findSku(request);
  const suffix = Date.now().toString(36).toUpperCase();

  await clearBinding(request, token, member.id);

  const hours = Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, [['08:00', '23:00']]]),
  );
  const storeRes = await request.post(`${API}/admin/stores`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      code: `CS${suffix}`,
      name: `库存门店 ${suffix}`,
      phone: '13800005556',
      region: '云南省昆明市五华区',
      address: 'E2E 库存路 6 号',
      pickupEnabled: true,
      deliveryEnabled: true,
      pickupCompleteDays: 7,
      businessHours: hours,
      managerUserId: member.id,
    },
  });
  expect(storeRes.ok(), await storeRes.text()).toBeTruthy();
  const store = unwrap<{ id: string; name: string }>(await storeRes.json());

  // 可售 1 ≤ 安全库存 5，进入预警
  const stock = await request.post(`${API}/admin/stores/${store.id}/skus/batch`, {
    headers: { authorization: `Bearer ${token}` },
    data: { items: [{ skuId, stock: 1, safetyStock: 5 }] },
  });
  expect(stock.ok(), await stock.text()).toBeTruthy();

  await injectToken(page, member.token);

  // 工作台库存预警入口 → 只看预警列表
  await page.goto(`${H5}/#/pages/store-console/index`);
  await expect(page.locator('.console-store')).toContainText(store.name, { timeout: 30_000 });
  await page.locator('.console-todo').nth(3).click();
  await expect(page).toHaveURL(/pages\/store-console\/stock/);
  await expect(page.locator('.stock-tag').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.stock-chip--warn')).toContainText('只看预警');

  // 调整库存为 30 / 安全库存 2 → 预警解除
  await page.getByText('调整库存', { exact: true }).first().click();
  await expect(page.locator('.stock-sheet')).toBeVisible();
  await page.locator('.stock-field input').nth(0).fill('30');
  await page.locator('.stock-field input').nth(1).fill('2');
  await page.getByText('保存', { exact: true }).click();
  await expect(page.getByText('库存已更新')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('暂无库存商品')).toBeVisible();

  // 营业设置：填写公告并保存
  await page.goto(`${H5}/#/pages/store-console/settings`);
  await expect(page.locator('.settings-store')).toContainText(store.name, { timeout: 30_000 });
  const notice = `E2E 公告 ${suffix}`;
  await page.locator('.settings-notice textarea').fill(notice);
  await page.getByText('保存营业设置', { exact: true }).click();
  await expect(page.getByText('营业设置已保存')).toBeVisible({ timeout: 30_000 });

  const saved = await request.get(`${API}/store-console/settings`, {
    headers: { authorization: `Bearer ${member.token}` },
  });
  expect(unwrap<{ notice: string | null }>(await saved.json()).notice).toBe(notice);

  // 清理绑定，避免影响下次运行
  await request.put(`${API}/admin/stores/${store.id}/manager`, {
    headers: { authorization: `Bearer ${token}` },
    data: { managerUserId: null },
  });
});

test('门店中心：临时打烊与移动端看板', async ({ page, request }) => {
  const token = await adminToken(request);
  const member = await loginSeedMember(request);
  const skuId = await findSku(request);
  const suffix = Date.now().toString(36).toUpperCase();

  await clearBinding(request, token, member.id);

  const storeRes = await request.post(`${API}/admin/stores`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      code: `CC${suffix}`,
      name: `打烊门店 ${suffix}`,
      phone: '13800005557',
      region: '云南省昆明市五华区',
      address: 'E2E 打烊路 5 号',
      pickupEnabled: true,
      deliveryEnabled: true,
      pickupCompleteDays: 7,
      managerUserId: member.id,
    },
  });
  expect(storeRes.ok(), await storeRes.text()).toBeTruthy();
  const store = unwrap<{ id: string; name: string }>(await storeRes.json());

  const stock = await request.post(`${API}/admin/stores/${store.id}/skus/batch`, {
    headers: { authorization: `Bearer ${token}` },
    data: { items: [{ skuId, stock: 10 }] },
  });
  expect(stock.ok(), await stock.text()).toBeTruthy();

  await injectToken(page, member.token);

  // 营业设置页：选择 1 小时后恢复并立即打烊
  await page.goto(`${H5}/#/pages/store-console/settings`);
  await expect(page.locator('.settings-store')).toContainText(store.name, { timeout: 30_000 });
  await page.locator('.settings-duration', { hasText: '1 小时' }).click();
  await page.locator('.settings-closure-note textarea').fill('E2E 设备检修');
  await page.getByText('立即打烊', { exact: true }).click();
  await expect(page.getByText('已临时打烊')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.settings-closed-tag')).toBeVisible();
  await expect(page.locator('.settings-closure')).toContainText('E2E 设备检修');

  // 工作台展示打烊横幅
  await page.goto(`${H5}/#/pages/store-console/index`);
  await expect(page.locator('.console-closed')).toContainText('临时打烊中', { timeout: 30_000 });

  // 恢复营业
  await page.goto(`${H5}/#/pages/store-console/settings`);
  await expect(page.locator('.settings-closure')).toContainText('打烊中', { timeout: 30_000 });
  await page.getByText('恢复营业', { exact: true }).click();
  await expect(page.getByText('已恢复营业')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.settings-closed-tag')).toHaveCount(0);

  // 移动端看板
  await page.goto(`${H5}/#/pages/store-console/dashboard`);
  await expect(page.locator('.dash-store')).toContainText(store.name, { timeout: 30_000 });
  await expect(page.getByText('今日支付订单')).toBeVisible();
  await expect(page.getByText('平均接单')).toBeVisible();
  await expect(page.getByText('库存预警')).toBeVisible();

  // 清理绑定，避免影响下次运行
  await request.put(`${API}/admin/stores/${store.id}/manager`, {
    headers: { authorization: `Bearer ${token}` },
    data: { managerUserId: null },
  });
});

test('门店中心：未关联门店的会员看不到入口', async ({ page }) => {
  const res = await page.request.post(`${API}/auth/wechat-login`, {
    data: { code: 'dev_miniapp_user' },
  });
  const token = unwrap<{ token: string }>(await res.json()).token;
  await injectToken(page, token);

  await page.goto(`${H5}/#/pages/mine/index`);
  await expect(page.getByText('我的优惠券')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.mine-store-entry')).toHaveCount(0);
});
