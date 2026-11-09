import { expect, test, type APIRequestContext } from '@playwright/test';

import { CONSENT, injectSession } from './session';

const H5 = 'http://127.0.0.1:8080';
const API = 'http://127.0.0.1:3000/api';

interface Envelope<T> {
  code: string;
  data: T;
}

function unwrap<T>(body: unknown): T {
  return (body as Envelope<T>).data;
}

async function loginToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/auth/wechat-login`, {
    data: { code: 'dev_miniapp_user', ...CONSENT },
  });
  expect(res.ok(), `接口登录失败：${res.status()}`).toBeTruthy();
  return unwrap<{ token: string }>(await res.json()).token;
}

test('登录页：未勾选不能登录，勾选后授权进入需登录页面', async ({ page }) => {
  await page.goto(`${H5}/#/pages/mine/index`);

  // 未登录进入「我的」→ 被引导到登录页
  await expect(page.locator('.login-btn')).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/pages\/login\/index/);

  // 未勾选协议时点击不登录、不跳转
  await page.locator('.login-btn').click();
  await expect(page.locator('.taro__toast')).toContainText('请先阅读并同意协议');
  await expect(page).toHaveURL(/pages\/login\/index/);
  await expect(page.locator('.login-check.on')).toHaveCount(0);
  // 等提示消失，避免遮挡按钮
  await expect(page.locator('.taro__toast')).toBeHidden({ timeout: 10_000 });

  // 勾选后登录成功，回跳到「我的」
  await page.locator('.login-check').click();
  await page.locator('.login-btn').click();
  await expect(page.getByText('我的订单')).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/pages\/mine\/index/);
  await expect(page.getByText('退出登录')).toBeVisible();
});

test('登录页：用户协议与隐私政策可打开全文', async ({ page }) => {
  await page.goto(`${H5}/#/pages/mine/index`);
  await expect(page.locator('.login-btn')).toBeVisible({ timeout: 30_000 });

  await page.getByText('《用户协议》').click();
  await expect(page).toHaveURL(/pages\/agreement\/index\?type=terms/);
  await expect(page.locator('.agreement-title')).toContainText('用户协议');
  await expect(page.locator('.agreement-meta')).toContainText('版本');

  await page.goBack();
  await page.getByText('《隐私政策》').click();
  await expect(page).toHaveURL(/pages\/agreement\/index\?type=privacy/);
  await expect(page.locator('.agreement-title')).toContainText('隐私政策');
  await expect(page.getByText('我们收集的信息')).toBeVisible();
});

test('退出登录：清空会话后再次进入需重新登录', async ({ page, request }) => {
  const token = await loginToken(request);
  await injectSession(page, token);

  await page.goto(`${H5}/#/pages/mine/index`);
  await expect(page.getByText('我的订单')).toBeVisible({ timeout: 30_000 });

  await page.locator('.mine-logout').click();
  await page.locator('.taro-model__confirm').click();

  // 回到首页未登录态
  await expect(page).toHaveURL(/pages\/home\/index/, { timeout: 30_000 });
  await expect(page.locator('.home-brand')).toContainText('山野');

  await page.goto(`${H5}/#/pages/mine/index`);
  await expect(page.locator('.login-btn')).toBeVisible({ timeout: 30_000 });
});

test('公开页面：未登录可匿名浏览首页', async ({ page }) => {
  await page.goto(`${H5}/#/pages/home/index`);
  await expect(page.locator('.home-brand')).toContainText('山野', { timeout: 30_000 });
  await expect(page.locator('.login-btn')).toHaveCount(0);
});
