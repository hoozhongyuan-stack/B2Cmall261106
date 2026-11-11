import { expect, test, type APIRequestContext } from '@playwright/test';

const ADMIN = 'http://127.0.0.1:5173';
const H5 = 'http://127.0.0.1:8080';
const API = 'http://127.0.0.1:3000/api';

const PROFILE_KEYS = [
  'serviceEmail',
  'serviceWechat',
  'serviceHours',
  'companyAddress',
  'companyName',
  'creditCode',
  'icpNumber',
  'icpUrl',
  'policeNumber',
  'policeUrl',
  'officialSiteUrl',
] as const;

interface Envelope<T> {
  code: string;
  data: T;
}

function unwrap<T>(body: unknown): T {
  return (body as Envelope<T>).data;
}

async function adminSession(
  request: APIRequestContext,
): Promise<{ token: string; user: Record<string, unknown> }> {
  const res = await request.post(`${API}/admin/auth/login`, {
    data: { account: 'admin@shanye.com', password: 'admin123' },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return unwrap<{ token: string; user: Record<string, unknown> }>(await res.json());
}

function injectAdmin(
  page: import('@playwright/test').Page,
  session: { token: string; user: Record<string, unknown> },
): Promise<void> {
  return page.addInitScript(
    ({ token, user }) => {
      localStorage.setItem('shanye_admin_token', token);
      localStorage.setItem('shanye_admin_user', JSON.stringify(user));
    },
    session,
  );
}

async function snapshotProfile(
  request: APIRequestContext,
  token: string,
): Promise<Record<string, string | null>> {
  const res = await request.get(`${API}/admin/shop`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const data = unwrap<Record<string, unknown>>(await res.json());
  const snapshot: Record<string, string | null> = {};
  for (const key of PROFILE_KEYS) {
    snapshot[key] = typeof data[key] === 'string' ? (data[key] as string) : null;
  }
  return snapshot;
}

async function patchProfile(
  request: APIRequestContext,
  token: string,
  body: Record<string, string | null>,
): Promise<void> {
  const res = await request.patch(`${API}/admin/shop`, {
    headers: { authorization: `Bearer ${token}` },
    data: body,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test('店铺基础信息：后台保存后关于我们与协议页展示主体备案', async ({ page, request }) => {
  const session = await adminSession(request);
  const token = session.token;
  const original = await snapshotProfile(request, token);
  await injectAdmin(page, session);

  try {
    await page.goto(`${ADMIN}/settings/shop`);
    await expect(page.getByRole('heading', { name: '店铺信息' })).toBeVisible();

    await page.getByLabel('客服邮箱').fill('service@shanye.test');
    await page.getByLabel('客服微信').fill('shanye-service');
    await page.getByLabel('服务时间').fill('9:00-21:00');
    await page.getByLabel('公司地址').fill('云南省昆明市盘龙区测试路 9 号');
    await page.getByLabel('公司名称').fill('云南山野商贸有限公司');
    await page.getByLabel('统一社会信用代码').fill('91530103MA6K12345X');
    await page.getByLabel('ICP 备案号').fill('滇ICP备2026000000号');
    await page.getByLabel('公安备案号').fill('滇公网安备53010302000000号');
    await page.getByLabel('官方商城地址').fill('https://shop.shanye.test');

    // 业务域名来自集成配置，店铺信息页只读展示
    await expect(page.getByLabel('业务域名')).toBeDisabled();

    await page.getByRole('button', { name: '保存设置' }).click();
    await expect(page.getByText('已保存')).toBeVisible();

    // 以接口值为准，避免页面缓存造成误判
    const saved = await request.get(`${API}/admin/shop`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const savedProfile = unwrap<Record<string, unknown>>(await saved.json());
    expect(savedProfile.serviceEmail).toBe('service@shanye.test');

    await page.goto(`${H5}/#/pages/about/index`);
    await expect(page.getByText('云南山野商贸有限公司')).toBeVisible();
    await expect(page.getByText('service@shanye.test')).toBeVisible();
    await expect(page.getByText('滇ICP备2026000000号')).toBeVisible();
    await expect(page.getByText('https://shop.shanye.test')).toBeVisible();

    await page.goto(`${H5}/#/pages/agreement/index?type=terms`);
    await expect(page.getByText(/运营主体：云南山野商贸有限公司/)).toBeVisible();
    await expect(page.getByText(/客服电话：400-800-1234/)).toBeVisible();
  } finally {
    await patchProfile(request, token, original);
  }
});
