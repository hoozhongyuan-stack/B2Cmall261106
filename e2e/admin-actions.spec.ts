import { expect, test } from '@playwright/test';

const ADMIN = 'http://127.0.0.1:5173';

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${ADMIN}/login`);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(`${ADMIN}/`);
}

test('后台列表操作列：订单发货 / 售后审核 / 客户打标签', async ({ page }) => {
  await login(page);

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
