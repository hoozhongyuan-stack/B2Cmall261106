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

async function adminSession(
  request: APIRequestContext,
  account = 'admin@shanye.com',
  password = 'admin123',
) {
  const res = await request.post(`${API}/admin/auth/login`, { data: { account, password } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return unwrap<{
    token: string;
    user: { id: string; name: string; isSuper: boolean; role: unknown; permissions: string[] };
  }>(await res.json());
}

async function injectAdmin(
  page: import('@playwright/test').Page,
  session: { token: string; user: unknown },
) {
  await page.addInitScript(
    ({ token, user }) => {
      localStorage.setItem('shanye_admin_token', token);
      localStorage.setItem('shanye_admin_user', JSON.stringify(user));
    },
    session,
  );
}

test('角色：新建、编辑、删除，子账号按角色选择', async ({ page, request }) => {
  const session = await adminSession(request);
  await injectAdmin(page, session);

  const name = `E2E角色${Date.now().toString(36)}`;
  const renamed = `${name}改`;

  await page.goto(`${ADMIN}/accounts/roles`);
  await expect(page.getByRole('heading', { name: '角色', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '新建角色' }).click();
  await expect(page.getByRole('heading', { name: '新建角色' })).toBeVisible();
  await page.getByLabel('角色名称').fill(name);
  await page.getByLabel('角色描述').fill('E2E 自动化创建的角色');
  // 勾选「交易」整组，保存后应自动包含查看与写权限
  await page
    .locator('.perm-group')
    .filter({ hasText: '交易' })
    .locator('input[type="checkbox"]')
    .first()
    .check();
  await page.getByRole('button', { name: '保存角色' }).first().click();
  await expect(page).toHaveURL(`${ADMIN}/accounts/roles`);
  await expect(page.getByText(name)).toBeVisible();

  // 编辑：改名后保存
  await page
    .getByRole('row')
    .filter({ hasText: name })
    .getByRole('button', { name: '编辑' })
    .click();
  await expect(page.getByRole('heading', { name: '编辑角色' })).toBeVisible();
  await page.getByLabel('角色名称').fill(renamed);
  await page.getByRole('button', { name: '保存角色' }).first().click();
  await expect(page.getByText(renamed)).toBeVisible();

  // 子账号弹窗的角色下拉来自接口
  await page.goto(`${ADMIN}/accounts`);
  await page.getByRole('button', { name: '新建子账号' }).click();
  await expect(page.locator('#account-create')).toBeVisible();
  await expect(page.locator('#account-create select').nth(1)).toContainText(renamed);
  await page.getByRole('button', { name: '取消' }).click();

  // 删除：无成员角色可直接删除
  await page.goto(`${ADMIN}/accounts/roles`);
  await page
    .getByRole('row')
    .filter({ hasText: renamed })
    .getByRole('button', { name: '删除' })
    .click();
  await page.locator('.modal').getByRole('button', { name: '确定' }).click();
  await expect(page.getByText(renamed)).toHaveCount(0);
});

test('角色：无权限账号直接访问角色页显示 403', async ({ page, request }) => {
  const session = await adminSession(request, 'cs@shanye.com', 'cs123456');
  await injectAdmin(page, session);
  await page.goto(`${ADMIN}/accounts/roles`);
  await expect(page.getByText('无权限访问')).toBeVisible();
  await expect(page.getByText('当前账号缺少权限：角色查看')).toBeVisible();
});
