import { expect, test } from '@playwright/test';

const ADMIN_URL = 'http://127.0.0.1:5173';

test('集成配置：读取参数、上传密钥、删除密钥', async ({ page }) => {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(`${ADMIN_URL}/`);

  await page.goto(`${ADMIN_URL}/settings/integration`);
  await expect(page.getByRole('heading', { name: '集成配置' })).toBeVisible();
  await expect(page.getByLabel('小程序 AppID')).toHaveValue(/^wx/);

  // 上传 AppSecret（虚拟文件，不落真实密钥）
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: 'e2e-appsecret.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('e2e-secret-value'),
  });
  await expect(page.getByText('e2e-appsecret.txt')).toBeVisible();

  // 删除并确认，恢复为未配置
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '删除' }).first().click();
  await expect(page.getByText('e2e-appsecret.txt')).toBeHidden();
});
