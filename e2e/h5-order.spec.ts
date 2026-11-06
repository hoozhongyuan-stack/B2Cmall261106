import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

const API = 'http://127.0.0.1:3000/api';
const H5 = 'http://127.0.0.1:8080';

interface Envelope<T> {
  code: string;
  data: T;
}

function unwrap<T>(body: unknown): T {
  return (body as Envelope<T>).data;
}

async function loginMiniapp(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/auth/wechat-login`, {
    data: { code: 'dev_miniapp_user' },
  });
  expect(res.ok(), `小程序登录失败：${res.status()} ${await res.text()}`).toBeTruthy();
  return unwrap<{ token: string }>(await res.json()).token;
}

/** 下单需要收货地址；测试用户缺省时补一条，返回新建 id 便于清理 */
async function ensureAddress(
  request: APIRequestContext,
  token: string,
): Promise<string | null> {
  const auth = { authorization: `Bearer ${token}` };
  const list = await request.get(`${API}/addresses`, { headers: auth });
  const items = unwrap<{ items: unknown[] }>(await list.json()).items;
  if (items.length > 0) return null;

  const created: APIResponse = await request.post(`${API}/addresses`, {
    headers: auth,
    data: {
      receiver: 'E2E 收货人',
      phone: '13800000000',
      region: '云南省 昆明市 五华区',
      detail: '测试路 1 号',
      isDefault: true,
    },
  });
  expect(created.ok(), `创建测试地址失败：${created.status()}`).toBeTruthy();
  return unwrap<{ id: string }>(await created.json()).id;
}

test('H5 下单到支付成功主链路', async ({ page, request }) => {
  const token = await loginMiniapp(request);
  const createdAddressId = await ensureAddress(request, token);

  try {
    const products = await request.get(`${API}/products?page=1&pageSize=1`);
    const productId = unwrap<{ items: { id: string }[] }>(await products.json()).items[0]?.id;
    expect(productId, '商品列表为空，请先执行 pnpm db:seed').toBeTruthy();

    await page.goto(`${H5}/#/pages/product/index?id=${productId}`);
    await expect(page.getByText('立即购买')).toBeVisible();
    await page.getByText('立即购买').click();

    await expect(page).toHaveURL(/pages\/checkout\/index/);
    await expect(page.getByText('提交订单')).toBeVisible();
    await page.getByText('提交订单').click();

    await expect(page.getByText('支付成功')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('查看订单')).toBeVisible();
  } finally {
    if (createdAddressId) {
      await request.delete(`${API}/addresses/${createdAddressId}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    }
  }
});
