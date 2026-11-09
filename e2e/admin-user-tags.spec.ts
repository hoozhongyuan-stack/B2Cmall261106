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

async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/admin/auth/login`, {
    data: { account: 'admin@shanye.com', password: 'admin123' },
  });
  expect(res.ok(), `管理员登录失败：${res.status()}`).toBeTruthy();
  return unwrap<{ token: string }>(await res.json()).token;
}

async function loginAdmin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${ADMIN}/login`);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(`${ADMIN}/`);
}

test('用户标签：两级标签展示与客户批量打标', async ({ page, request }) => {
  const token = await adminToken(request);
  const headers = { authorization: `Bearer ${token}` };
  const stamp = Date.now();
  const rootName = `E2E价值分层${stamp}`;
  const childName = `E2E高价值${stamp}`;

  const customers = await request.get(`${API}/admin/customers?page=1&pageSize=1`, { headers });
  const user = unwrap<{ items: { id: string; nickname: string | null; phone: string | null }[] }>(
    await customers.json(),
  ).items[0];
  expect(user?.id, '需要至少一个客户').toBeTruthy();

  const rootRes = await request.post(`${API}/admin/user-tags`, {
    headers,
    data: { name: rootName },
  });
  expect(rootRes.ok(), `创建一级标签失败：${rootRes.status()}`).toBeTruthy();
  const rootId = unwrap<{ id: string }>(await rootRes.json()).id;

  const childRes = await request.post(`${API}/admin/user-tags`, {
    headers,
    data: { name: childName, parentId: rootId },
  });
  expect(childRes.ok(), `创建二级标签失败：${childRes.status()}`).toBeTruthy();
  const childId = unwrap<{ id: string }>(await childRes.json()).id;

  // 先通过接口给客户打二级标签，便于在列表中用一级标签筛选定位
  const assign = await request.post(`${API}/admin/customers/batch/tags`, {
    headers,
    data: { userIds: [user.id], tagIds: [childId], mode: 'add' },
  });
  expect(assign.ok(), `打标签失败：${assign.status()}`).toBeTruthy();

  await loginAdmin(page);

  // 标签管理：两级标签都在树中
  await page.goto(`${ADMIN}/user-tags`);
  await expect(page.getByRole('heading', { name: '用户标签' })).toBeVisible();
  await expect(page.locator('tr', { hasText: rootName })).toBeVisible();
  await expect(page.locator('tr', { hasText: childName })).toBeVisible();

  // 客户列表：先按手机号/昵称收敛到该客户，再按一级标签筛选后批量打标
  await page.goto(`${ADMIN}/customers`);
  await expect(page.getByRole('heading', { name: '客户列表' })).toBeVisible();
  const customerLabel = user.phone ?? user.nickname ?? '';
  if (customerLabel) {
    await page.getByLabel('搜索客户').fill(customerLabel);
    await page.getByRole('button', { name: '搜索' }).click();
  }
  await page.getByLabel('按标签筛选').selectOption(rootId);

  const row = page.locator('tbody tr', { hasText: customerLabel }).first();
  await expect(row).toBeVisible();
  await row.getByRole('checkbox').check();

  await page.getByRole('button', { name: '添加标签' }).click();
  const modal = page.locator('.modal');
  await modal.locator('label', { hasText: rootName }).locator('input[type="checkbox"]').check();
  await modal.getByRole('button', { name: '确认添加' }).click();
  await expect(page.getByText(/已添加标签/)).toBeVisible();

  // 校验客户已同时拥有两级标签
  const detail = await request.get(`${API}/admin/customers/${user.id}`, { headers });
  const tags = unwrap<{ tags: { id: string }[] }>(await detail.json()).tags;
  expect(tags.map((item) => item.id)).toEqual(expect.arrayContaining([rootId, childId]));

  // 清理：删除一级标签会级联删除二级与绑定
  await request.delete(`${API}/admin/user-tags/${rootId}`, { headers });
});
