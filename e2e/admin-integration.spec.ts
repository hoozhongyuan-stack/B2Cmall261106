import { expect, test } from '@playwright/test';

const ADMIN_URL = 'http://127.0.0.1:5173';

test('集成配置：填写 AppSecret 保存并清除', async ({ page }) => {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(`${ADMIN_URL}/`);

  await page.goto(`${ADMIN_URL}/settings/integration`);
  await expect(page.getByRole('heading', { name: '集成配置' })).toBeVisible();
  await expect(page.getByLabel('小程序 AppID')).toHaveValue(/^wx/);

  const secretField = page.locator('.field').filter({ hasText: '小程序 AppSecret' });

  // 文本框录入 32 位 AppSecret（E2E 使用假值，保存后立即清除）
  await secretField.locator('input[type="password"]').fill('e2eappsecret0123456789abcdefghij');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(secretField.getByText('已配置')).toBeVisible();
  await expect(secretField.locator('input[type="password"]')).toHaveValue('');

  // 清除后恢复未配置
  page.once('dialog', (dialog) => void dialog.accept());
  await secretField.getByRole('button', { name: '清除' }).click();
  await expect(secretField.getByText('未配置')).toBeVisible();
});
