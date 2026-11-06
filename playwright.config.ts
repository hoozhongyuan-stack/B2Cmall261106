import { defineConfig, devices } from '@playwright/test';

const ADMIN_URL = 'http://127.0.0.1:5173';
const H5_URL = 'http://127.0.0.1:8080';

/**
 * 主链路 E2E：后台登录 + H5 下单支付。
 * 与 pnpm verify 分开（需要真实数据库与三端进程），单独执行 pnpm test:e2e。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // 直接复用本机 / CI 自带的 Chrome，省去 180MB Chromium 下载
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: [
    {
      command: 'pnpm --filter @shanye/api build && pnpm --filter @shanye/api start',
      url: 'http://127.0.0.1:3000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'pnpm --filter @shanye/admin dev',
      url: ADMIN_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @shanye/miniapp dev:h5',
      url: H5_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
});
