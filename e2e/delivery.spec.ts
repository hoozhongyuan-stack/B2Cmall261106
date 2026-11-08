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
  throw new Error('没有可用于配送测试的普通商品，请先执行 pnpm db:seed');
}

interface DeliveryContext {
  productId: string;
  skuId: string;
  store: { id: string; name: string };
  addressId: string;
}

/** 建一个可配送门店 + 库存 + 默认收货地址（五华区），供 API / H5 两条链路复用 */
async function setupDeliveryContext(
  request: APIRequestContext,
  admin: string,
  user: string,
): Promise<DeliveryContext> {
  const { productId, skuId } = await firstSku(request);
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 100)}`.toUpperCase();

  // 复用测试用户已有地址，避免多次 E2E 触达地址数量上限
  const addressList = await request.get(`${API}/addresses`, {
    headers: { authorization: `Bearer ${user}` },
  });
  const existing = unwrap<{ items: { id: string; region: string }[] }>(
    await addressList.json(),
  ).items;
  let addressId = existing[0]?.id ?? '';
  const addressRegion = existing[0]?.region ?? '云南省昆明市五华区';
  if (!addressId) {
    const addressRes = await request.post(`${API}/addresses`, {
      headers: { authorization: `Bearer ${user}` },
      data: {
        receiver: '配送 E2E 收货人',
        phone: '13900007777',
        region: addressRegion,
        detail: 'E2E 配送 2 号',
        isDefault: true,
      },
    });
    expect(addressRes.ok(), await addressRes.text()).toBeTruthy();
    addressId = unwrap<{ id: string }>(await addressRes.json()).id;
  }

  const storeRes = await request.post(`${API}/admin/stores`, {
    headers: { authorization: `Bearer ${admin}` },
    data: {
      code: `DL${suffix}`,
      name: `配送门店 ${suffix}`,
      region: '云南省昆明市五华区',
      address: 'E2E 配送路 1 号',
      deliveryEnabled: true,
      deliveryFeeCents: 500,
      freeDeliveryThresholdCents: 0,
      deliverySlots: ['00:00-23:59'],
      deliveryCutoff: '23:58',
      maxOrdersPerSlot: 0,
      deliveryRegions: [addressRegion],
    },
  });
  expect(storeRes.ok(), await storeRes.text()).toBeTruthy();
  const store = unwrap<{ id: string; name: string }>(await storeRes.json());

  const stock = await request.post(`${API}/admin/stores/${store.id}/skus/batch`, {
    headers: { authorization: `Bearer ${admin}` },
    data: { items: [{ skuId, stock: 5 }] },
  });
  expect(stock.ok()).toBeTruthy();

  return { productId, skuId, store, addressId };
}

async function createPaidDeliveryOrder(
  request: APIRequestContext,
  admin: string,
  user: string,
): Promise<{ orderId: string; orderNo: string; storeId: string; storeName: string }> {
  const { skuId, store, addressId } = await setupDeliveryContext(request, admin, user);

  const created = await request.post(`${API}/orders`, {
    headers: {
      authorization: `Bearer ${user}`,
      'idempotency-key': `e2e-delivery-${Date.now()}-${Math.random()}`,
    },
    data: {
      items: [{ skuId, quantity: 1 }],
      fulfillmentType: 'DELIVERY',
      storeId: store.id,
      deliverySlot: '00:00-23:59',
      addressId,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const order = unwrap<{ id: string; orderNo: string }>(await created.json());

  const pay = await request.post(`${API}/orders/${order.id}/pay`, {
    headers: { authorization: `Bearer ${user}` },
  });
  expect(pay.ok()).toBeTruthy();
  const outTradeNo = unwrap<{ outTradeNo: string }>(await pay.json()).outTradeNo;
  const confirmed = await request.post(`${API}/payments/mock/confirm`, {
    headers: { authorization: `Bearer ${user}` },
    data: { outTradeNo },
  });
  expect(confirmed.ok()).toBeTruthy();

  return { orderId: order.id, orderNo: order.orderNo, storeId: store.id, storeName: store.name };
}

async function loginAdmin(page: Page): Promise<void> {
  await page.goto(`${ADMIN}/login`);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(`${ADMIN}/`);
}

test('配送后台：接单、送达与取消', async ({ page, request }) => {
  const admin = await adminToken(request);
  const user = await loginMiniapp(request);
  const first = await createPaidDeliveryOrder(request, admin, user);
  const second = await createPaidDeliveryOrder(request, admin, user);

  await loginAdmin(page);
  await page.goto(`${ADMIN}/fulfillment/deliveries`);
  await expect(page.getByRole('heading', { name: '同城配送' })).toBeVisible();

  // 待接单 → 接单
  const row = page.locator('tr', { hasText: first.orderNo });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: '接单' }).click();
  const acceptModal = page.locator('.modal');
  await expect(acceptModal.getByText('接单', { exact: true })).toBeVisible();
  await acceptModal.locator('input').nth(0).fill('E2E 骑手');
  await acceptModal.locator('input').nth(1).fill('13700001234');
  await acceptModal.locator('.modal-ft').getByRole('button', { name: '确认接单' }).click();
  await expect(page.getByText('已接单')).toBeVisible();

  // 配送中 → 送达
  await page.getByRole('button', { name: '配送中' }).click();
  const acceptedRow = page.locator('tr', { hasText: first.orderNo });
  await expect(acceptedRow).toBeVisible();
  await expect(acceptedRow.getByText('E2E 骑手')).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await acceptedRow.getByRole('button', { name: '送达' }).click();
  await expect(page.locator('.toast').filter({ hasText: '已送达' })).toBeVisible();

  // 已送达
  await page.getByRole('button', { name: '已送达' }).click();
  await expect(page.locator('tr', { hasText: first.orderNo })).toBeVisible();

  const done = await request.get(`${API}/orders/${first.orderId}`, {
    headers: { authorization: `Bearer ${user}` },
  });
  const doneOrder = unwrap<{ status: string; delivery: { status: string } | null }>(
    await done.json(),
  );
  expect(doneOrder.status).toBe('COMPLETED');
  expect(doneOrder.delivery?.status).toBe('DELIVERED');

  // 待接单 → 取消（原因必填）
  await page.getByRole('button', { name: '待接单' }).click();
  const pendingRow = page.locator('tr', { hasText: second.orderNo });
  await expect(pendingRow).toBeVisible();
  await pendingRow.getByRole('button', { name: '取消' }).click();
  const cancelModal = page.locator('.modal');
  await cancelModal.locator('.modal-ft').getByRole('button', { name: '确认取消' }).click();
  await expect(page.getByText('请填写取消原因')).toBeVisible();
  await cancelModal.locator('textarea').fill('E2E 门店临时闭店');
  await cancelModal.locator('.modal-ft').getByRole('button', { name: '确认取消' }).click();
  await expect(page.getByText('已取消配送')).toBeVisible();

  // 已取消 tab 可见
  await page.getByRole('button', { name: '已取消' }).click();
  await expect(page.locator('tr', { hasText: second.orderNo })).toBeVisible();

  // 超时 tab + 门店筛选：已送达/已取消不计入超时
  await page.getByLabel('门店筛选').selectOption({ label: first.storeName });
  await page.getByRole('button', { name: '超时' }).click();
  await expect(page.getByText('暂无超时配送单')).toBeVisible();
});

test('H5 同城配送：选择门店与时段，详情展示配送员并支持联系', async ({ page, request }) => {
  const admin = await adminToken(request);
  const user = await loginMiniapp(request);
  const ctx = await setupDeliveryContext(request, admin, user);

  await page.goto(`${H5}/#/pages/product/index?id=${ctx.productId}`);
  await expect(page.getByText('立即购买')).toBeVisible();
  await page.getByText('立即购买').click();
  await expect(page).toHaveURL(/pages\/checkout\/index/);

  // 切换同城配送：自动进入配送门店选择页
  await page.getByText('同城配送', { exact: true }).click();
  await expect(page).toHaveURL(/pages\/store\/list\/index/);
  await expect(page.getByText(ctx.store.name, { exact: true })).toBeVisible();
  await page.getByText(ctx.store.name, { exact: true }).click();

  // 回到结算页：选择配送时段并提交
  await expect(page.getByText('配送时段', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(ctx.store.name)).toBeVisible();
  const slot = page.locator('.checkout-slot').first();
  await expect(slot).toBeVisible();
  await slot.click();
  await expect(slot).toHaveClass(/checkout-slot--on/);

  await page.getByText('提交订单').click();
  await expect(page.getByText('支付成功')).toBeVisible({ timeout: 45_000 });
  await page.getByText('查看订单').click();

  // 订单详情：待接单 + 预计送达
  await expect(page.getByText('配送信息')).toBeVisible();
  await expect(page.getByText('预计送达')).toBeVisible();
  await expect(page.getByText('00:00-23:59')).toBeVisible();
  await expect(page.getByText('待接单', { exact: true }).first()).toBeVisible();

  // 后台接单 → 送达（复用同一浏览器上下文的新标签页）
  const orderNo = (await page.locator('.od-head .tiny').innerText()).trim();
  const adminPage = await page.context().newPage();
  await loginAdmin(adminPage);
  await adminPage.goto(`${ADMIN}/fulfillment/deliveries`);
  const pendingRow = adminPage.locator('tr', { hasText: orderNo });
  await expect(pendingRow.getByText('待接单')).toBeVisible();
  await pendingRow.getByRole('button', { name: '接单' }).click();
  const acceptModal = adminPage.locator('.modal');
  await acceptModal.locator('input').nth(0).fill('H5 骑手');
  await acceptModal.locator('input').nth(1).fill('13700003333');
  await acceptModal.locator('.modal-ft').getByRole('button', { name: '确认接单' }).click();
  await expect(adminPage.locator('.toast').filter({ hasText: '已接单' })).toBeVisible();

  await adminPage.getByRole('button', { name: '配送中' }).click();
  const acceptedRow = adminPage.locator('tr', { hasText: orderNo });
  await expect(acceptedRow.getByText('H5 骑手')).toBeVisible();
  adminPage.once('dialog', (dialog) => void dialog.accept());
  await acceptedRow.getByRole('button', { name: '送达' }).click();
  await expect(adminPage.locator('.toast').filter({ hasText: '已送达' })).toBeVisible();
  await adminPage.close();

  // 小程序订单详情同步为已完成，并展示配送员与联系入口
  await page.reload();
  await expect(page.getByText('已完成', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('已送达', { exact: true })).toBeVisible();
  await expect(page.getByText('H5 骑手')).toBeVisible();
  await expect(page.getByText('13700003333 · 联系')).toBeVisible();
});
