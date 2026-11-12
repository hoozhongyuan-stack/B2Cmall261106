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

interface AdminUser {
  id: string;
  name: string;
  isSuper: boolean;
  role: { id: string; name: string } | null;
  permissions: string[];
}

async function adminSession(
  request: APIRequestContext,
): Promise<{ token: string; user: AdminUser }> {
  const res = await request.post(`${API}/admin/auth/login`, {
    data: { account: 'admin@shanye.com', password: 'admin123' },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return unwrap<{ token: string; user: AdminUser }>(await res.json());
}

/** 直接写入后台登录态，避免 E2E 集中登录触发登录限流 */
async function injectAdmin(
  page: import('@playwright/test').Page,
  session: { token: string; user: AdminUser },
): Promise<void> {
  await page.addInitScript(
    ({ token, user }) => {
      localStorage.setItem('shanye_admin_token', token);
      localStorage.setItem('shanye_admin_user', JSON.stringify(user));
    },
    session,
  );
}

async function userToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/auth/wechat-login`, {
    data: { code: 'dev_miniapp_user', ...CONSENT },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return unwrap<{ token: string }>(await res.json()).token;
}

test('门店新建/编辑为独立页面，含省市区与地图选点', async ({ page, request }) => {
  const session = await adminSession(request);
  const headers = { authorization: `Bearer ${session.token}` };
  await injectAdmin(page, session);

  // 新建页：独立路由，不是弹窗
  await page.goto(`${ADMIN}/settings/stores/new`);
  await expect(page.getByRole('heading', { name: '新建门店' })).toBeVisible();
  await expect(page.locator('.map-picker-canvas')).toBeVisible();
  await expect(page.getByLabel('省份')).toBeVisible();
  await expect(page.getByLabel('详细地址')).toBeVisible();

  // 编辑页：读取现有门店并回填
  const list = await request.get(`${API}/admin/stores?pageSize=1`, { headers });
  const first = unwrap<{ items: { id: string; name: string }[] }>(await list.json()).items[0];
  expect(first).toBeTruthy();
  await page.goto(`${ADMIN}/settings/stores/${first.id}/edit`);
  await expect(page.getByRole('heading', { name: /编辑门店/ })).toBeVisible();
  await expect(page.getByLabel('门店名称')).toHaveValue(first.name);
  await expect(page.locator('.map-picker-canvas')).toBeVisible();
});

test('积分规则可配置，小程序展示签到与积分流水', async ({ page, request }) => {
  const session = await adminSession(request);
  const headers = { authorization: `Bearer ${session.token}` };
  const originalRes = await request.get(`${API}/admin/points-config`, { headers });
  const original = unwrap<Record<string, unknown>>(await originalRes.json());
  await injectAdmin(page, session);

  try {
    // 后台配置页
    await page.goto(`${ADMIN}/points-rules`);
    await expect(page.getByRole('heading', { name: '积分规则' })).toBeVisible();
    await expect(page.getByLabel('每日签到积分')).toBeVisible();
    await page.getByLabel('每日签到积分').fill('5');
    await page.getByLabel('每次分享赠送积分').fill('2');
    await page.getByLabel('每天最多计入次数').fill('2');
    await page.getByRole('button', { name: '保存规则' }).first().click();
    await expect(page.getByText('积分规则已保存')).toBeVisible();

    // 小程序积分页：签到入口与流水
    const token = await userToken(request);
    await injectSession(page, token);
    await page.goto(`${H5}/#/pages/points/index`);
    await expect(page.getByText('当前积分')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('积分流水')).toBeVisible();
    const signInButton = page.locator('.points-task-btn').first();
    await expect(signInButton).toBeVisible();
    const signInText = (await signInButton.textContent()) ?? '';
    if (signInText.includes('今日已签到')) {
      await expect(signInButton).toContainText('今日已签到');
    } else {
      await signInButton.click();
      await expect(page.locator('.taro__toast')).toContainText(/签到成功/, { timeout: 10_000 });
    }
  } finally {
    await request.put(`${API}/admin/points-config`, { headers, data: original });
  }
});
