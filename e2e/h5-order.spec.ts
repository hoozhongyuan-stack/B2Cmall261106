import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

import { CONSENT, injectSession } from './session';

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
    data: { code: 'dev_miniapp_user', ...CONSENT },
  });
  expect(res.ok(), `小程序登录失败：${res.status()} ${await res.text()}`).toBeTruthy();
  return unwrap<{ token: string }>(await res.json()).token;
}

/** 选一个未参与秒杀且有库存的商品，避免本地活动数据影响主链路 */
async function pickPlainProduct(request: APIRequestContext): Promise<string | undefined> {
  const list = await request.get(`${API}/products?page=1&pageSize=20`);
  const items = unwrap<{ items: { id: string }[] }>(await list.json()).items;
  for (const item of items) {
    const detail = await request.get(`${API}/products/${item.id}`);
    const data = unwrap<{
      skus: { available: number; status: string; seckill?: unknown }[];
    }>(await detail.json());
    const usable = data.skus.find(
      (sku) => sku.available > 0 && sku.status === 'ON_SALE' && !sku.seckill,
    );
    if (usable) return item.id;
  }
  return items[0]?.id;
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
    const productId = await pickPlainProduct(request);
    expect(productId, '商品列表为空，请先执行 pnpm db:seed').toBeTruthy();

    await injectSession(page, token);
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
