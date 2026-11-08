import { expect, test } from '@playwright/test';

const ADMIN_URL = 'http://127.0.0.1:5173';

test('小程序发布页：环境状态与未配置提示', async ({ page }) => {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(`${ADMIN_URL}/`);

  await page.goto(`${ADMIN_URL}/settings/miniapp-release`);
  await expect(page.getByRole('heading', { name: '小程序发布' })).toBeVisible();
  await expect(page.getByText('代码上传密钥', { exact: true })).toBeVisible();
  // 本地库可能已有历史发布记录；有记录时校验版本表，空库时校验空态
  await expect(page.locator('.table-wrap table, .empty').first()).toBeVisible();
});
