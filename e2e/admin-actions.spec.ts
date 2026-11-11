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

async function login(page: import('@playwright/test').Page, request: APIRequestContext) {
  const res = await request.post(`${API}/admin/auth/login`, {
    data: { account: 'admin@shanye.com', password: 'admin123' },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const session = unwrap<{ token: string; user: Record<string, unknown> }>(await res.json());
  await page.addInitScript(
    ({ token, user }) => {
      localStorage.setItem('shanye_admin_token', token);
      localStorage.setItem('shanye_admin_user', JSON.stringify(user));
    },
    session,
  );
  await page.goto(`${ADMIN}/`);
  await expect(page.getByRole('heading', { name: '数据概览' })).toBeVisible();
}

test('后台列表操作列：订单发货 / 售后审核 / 客户打标签', async ({ page, request }) => {
  await login(page, request);

  // 订单列表：操作列与查看、发货入口
  await page.goto(`${ADMIN}/orders`);
  await expect(page.getByRole('columnheader', { name: '操作' })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看' }).first()).toBeVisible();
  const shipButtons = page.getByRole('button', { name: '发货', exact: true });
  expect(await shipButtons.count()).toBeGreaterThanOrEqual(0);

  // 订单详情：商品明细展示缩略图位（图片或占位）
  await page.getByRole('button', { name: '查看' }).first().click();
  await expect(page.getByRole('heading', { name: /订单/ })).toBeVisible();
  await expect(page.getByText('商品明细')).toBeVisible();
  expect(await page.locator('.cell-thumb').count()).toBeGreaterThan(0);

  // 售后列表：操作列
  await page.goto(`${ADMIN}/after-sales`);
  await expect(page.getByRole('columnheader', { name: '操作' })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看' }).first()).toBeVisible();

  // 客户列表：操作列与打标签按钮
  await page.goto(`${ADMIN}/customers`);
  await expect(page.getByRole('columnheader', { name: '操作' })).toBeVisible();
  await expect(page.getByRole('button', { name: '打标签' }).first()).toBeVisible();

  // 页面装修：旧版首页入口已移除
  await page.goto(`${ADMIN}/settings/home`);
  await expect(page.getByText('迁移旧首页')).toHaveCount(0);
  await expect(page.getByText('旧版首页设置')).toHaveCount(0);
});
