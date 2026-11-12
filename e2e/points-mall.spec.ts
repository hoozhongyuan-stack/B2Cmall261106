import { expect, test, type APIRequestContext } from '@playwright/test';

import { CONSENT, injectSession } from './session';

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
  expect(res.ok(), await res.text()).toBeTruthy();
  return unwrap<{ token: string }>(await res.json()).token;
}

test('后台配置积分商品，小程序纯积分兑换全流程', async ({ page, request }) => {
  const token = await adminToken(request);
  const headers = { authorization: `Bearer ${token}` };

  await page.addInitScript((value) => {
    localStorage.setItem('shanye_admin_token', value);
    localStorage.setItem(
      'shanye_admin_user',
      JSON.stringify({
        id: 'e2e',
        name: 'E2E 管理员',
        isSuper: true,
        role: null,
        permissions: [],
      }),
    );
  }, token);

  // 种子用户：已有收货地址，补足积分用于兑换
  const customers = await request.get(`${API}/admin/customers?keyword=dev_seed_user`, { headers });
  const userId = unwrap<{ items: { id: string }[] }>(await customers.json()).items[0]?.id;
  expect(userId).toBeTruthy();
  const adjusted = await request.post(`${API}/admin/customers/${userId}/points`, {
    headers,
    data: { delta: 5000, reason: 'E2E 积分商城兑换' },
  });
  expect(adjusted.ok(), await adjusted.text()).toBeTruthy();

  const categories = await request.get(`${API}/admin/categories`, { headers });
  const roots = unwrap<{ id: string; children?: { id: string }[] }[]>(await categories.json());
  const categoryId = roots.find((root) => (root.children ?? []).length > 0)?.children?.[0]?.id ??
    roots[0]?.id;
  expect(categoryId).toBeTruthy();

  const title = `E2E 积分商品${Date.now()}`;
  const created = await request.post(`${API}/admin/products`, {
    headers,
    data: {
      title,
      categoryId,
      channel: 'POINTS',
      pointsLimitPerUser: 1,
      status: 'ON_SALE',
      skus: [
        { specJson: { 规格: '默认' }, priceCents: 0, pointsCost: 100, stock: 3 },
      ],
    },
  });
  expect(created.status(), await created.text()).toBe(201);

  // 后台积分商城列表出现该商品
  await page.goto(`${ADMIN}/marketing/points-mall`);
  await expect(page.getByRole('heading', { name: '积分商城' })).toBeVisible();
  await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });

  // 小程序积分商城 → 兑换详情 → 纯积分兑换成功
  const login = await request.post(`${API}/auth/wechat-login`, {
    data: { code: 'seed_user', ...CONSENT },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  const userToken = unwrap<{ token: string }>(await login.json()).token;
  await injectSession(page, userToken);

  await page.goto(`${H5}/#/pages/points-mall/index`);
  await expect(page.getByText('我的积分')).toBeVisible({ timeout: 30_000 });
  await page.getByText(title).first().click();
  await expect(page.getByText('立即兑换')).toBeVisible({ timeout: 15_000 });
  await page.getByText('立即兑换', { exact: true }).click();
  await expect(page.getByText('确认兑换')).toBeVisible();
  await page.getByText('确定', { exact: true }).click();
  await expect(page.getByText('支付成功')).toBeVisible({ timeout: 20_000 });
});
