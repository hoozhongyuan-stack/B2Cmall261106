import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type APIRequestContext } from '@playwright/test';

const H5 = 'http://127.0.0.1:8080';
const API = 'http://127.0.0.1:3000/api';
const SEEN_KEY = 'shanye_popup_seen';

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
  expect(res.ok(), await res.text()).toBeTruthy();
  return unwrap<{ token: string }>(await res.json()).token;
}

async function uploadImage(request: APIRequestContext, token: string): Promise<{ id: string; key: string }> {
  const file = readFileSync(
    join(process.cwd(), 'apps/miniapp/src/static/products/tea-01.jpg'),
  );
  const res = await request.post(`${API}/admin/assets/upload`, {
    headers: { authorization: `Bearer ${token}` },
    multipart: {
      files: { name: 'popup-ad.jpg', mimeType: 'image/jpeg', buffer: file },
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return unwrap<{ items: { id: string; key: string }[] }>(await res.json()).items[0];
}

async function createAd(
  request: APIRequestContext,
  token: string,
  data: { name: string; imageKey: string; priority: number; link?: unknown },
): Promise<string> {
  const res = await request.post(`${API}/admin/popup-ads`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: data.name,
      imageKey: data.imageKey,
      alt: data.name,
      link: data.link ?? { type: 'none', value: null },
      priority: data.priority,
      enabled: true,
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return unwrap<{ id: string }>(await res.json()).id;
}

async function seenIds(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    try {
      return JSON.parse(raw).data?.adIds ?? [];
    } catch {
      return [];
    }
  }, SEEN_KEY);
}

/** 清掉历史用例残留（用例失败时清理可能被跳过） */
async function purgeTestAds(request: APIRequestContext, token: string): Promise<void> {
  const res = await request.get(`${API}/admin/popup-ads?pageSize=100`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok()) return;
  const items = unwrap<{ items: { id: string; name: string }[] }>(await res.json()).items ?? [];
  for (const item of items) {
    if (!item.name.startsWith('E2E ')) continue;
    await request.delete(`${API}/admin/popup-ads/${item.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  }
}

/** 暂时停用非 E2E 广告，避免真实投放干扰断言；用例结束后恢复 */
async function suppressOtherAds(
  request: APIRequestContext,
  token: string,
): Promise<string[]> {
  const res = await request.get(`${API}/admin/popup-ads?pageSize=100`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok()) return [];
  const items =
    unwrap<{ items: { id: string; name: string; enabled: boolean }[] }>(await res.json()).items ??
    [];
  const disabled: string[] = [];
  for (const item of items) {
    if (!item.enabled || item.name.startsWith('E2E ')) continue;
    const toggled = await request.patch(`${API}/admin/popup-ads/${item.id}/enabled`, {
      headers: { authorization: `Bearer ${token}` },
      data: { enabled: false },
    });
    if (toggled.ok()) disabled.push(item.id);
  }
  return disabled;
}

async function restoreAds(
  request: APIRequestContext,
  token: string,
  ids: string[],
): Promise<void> {
  for (const id of ids) {
    await request.patch(`${API}/admin/popup-ads/${id}/enabled`, {
      headers: { authorization: `Bearer ${token}` },
      data: { enabled: true },
    });
  }
}

test('弹窗广告：多条依次弹出，每天一次，次日恢复', async ({ page, request }) => {
  const token = await adminToken(request);
  await purgeTestAds(request, token);
  const suppressed = await suppressOtherAds(request, token);
  const asset = await uploadImage(request, token);
  const ads: string[] = [];

  try {
    ads.push(
      await createAd(request, token, { name: 'E2E 弹窗低', imageKey: asset.key, priority: 1 }),
    );
    ads.push(
      await createAd(request, token, { name: 'E2E 弹窗高', imageKey: asset.key, priority: 9 }),
    );

    await page.goto(`${H5}/#/pages/home/index`);
    await expect(page.locator('.popup-ad-mask')).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await seenIds(page)).length).toBe(1);

    // 关闭第一条，自动弹下一条
    await page.locator('.popup-ad-close').click();
    await expect(page.locator('.popup-ad-mask')).toBeVisible();
    await expect.poll(async () => (await seenIds(page)).length).toBe(2);

    // 关闭最后一条
    await page.locator('.popup-ad-close').click();
    await expect(page.locator('.popup-ad-mask')).toHaveCount(0);

    // 同一天刷新不再弹
    await page.reload();
    await page.waitForTimeout(1500);
    await expect(page.locator('.popup-ad-mask')).toHaveCount(0);

    // 模拟次日：日期改为过去，再打开应重新弹
    await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const payload = JSON.parse(raw);
      payload.data.date = '2000-01-01';
      localStorage.setItem(key, JSON.stringify(payload));
    }, SEEN_KEY);
    await page.reload();
    await expect(page.locator('.popup-ad-mask')).toBeVisible({ timeout: 15_000 });
  } finally {
    for (const id of ads) {
      await request.delete(`${API}/admin/popup-ads/${id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    }
    await request.delete(`${API}/admin/assets/${asset.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await restoreAds(request, token, suppressed);
  }
});

test('弹窗广告：点击图片跳转并停止剩余弹窗', async ({ page, request }) => {
  const token = await adminToken(request);
  await purgeTestAds(request, token);
  const asset = await uploadImage(request, token);
  const first = await createAd(request, token, {
    name: 'E2E 可跳转弹窗',
    imageKey: asset.key,
    priority: 5,
    link: { type: 'page', value: '/pages/search/index' },
  });
  const second = await createAd(request, token, {
    name: 'E2E 后续弹窗',
    imageKey: asset.key,
    priority: 1,
  });

  try {
    await page.goto(`${H5}/#/pages/home/index`);
    await expect(page.locator('.popup-ad-mask')).toBeVisible({ timeout: 15_000 });
    await page.locator('.popup-ad-image-wrap').click();
    await expect(page).toHaveURL(/pages\/search\/index/, { timeout: 15_000 });
    expect(await seenIds(page)).toContain(first);
    expect(await seenIds(page)).not.toContain(second);
  } finally {
    for (const id of [first, second]) {
      await request.delete(`${API}/admin/popup-ads/${id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    }
    await request.delete(`${API}/admin/assets/${asset.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  }
});
