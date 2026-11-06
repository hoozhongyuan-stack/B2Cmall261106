import { expect, test } from '@playwright/test';

const ADMIN_URL = 'http://127.0.0.1:5173';

test('后台登录后进入数据概览', async ({ page }) => {
  await page.goto(`${ADMIN_URL}/login`);
  await expect(page.getByRole('heading', { name: '登录后台' })).toBeVisible();

  // 种子账号已在表单中预填：admin@shanye.com / admin123
  await page.getByRole('button', { name: '登录' }).click();

  await expect(page).toHaveURL(`${ADMIN_URL}/`);
  await expect(page.getByRole('heading', { name: '数据概览' })).toBeVisible();
  await expect(page.getByText('今日支付订单')).toBeVisible();
});

test('未登录访问后台被重定向到登录页', async ({ page }) => {
  await page.goto(`${ADMIN_URL}/orders`);
  await expect(page).toHaveURL(`${ADMIN_URL}/login`);
});
