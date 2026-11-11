import { expect, test, type APIRequestContext } from '@playwright/test';

const H5 = 'http://127.0.0.1:8080';
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

const DEFAULT_TABBAR = {
  enabled: true,
  style: {},
  items: [
    { key: 'home', text: '首页', iconKey: null, activeIconKey: null, link: { type: 'page', value: '/pages/home/index' } },
    { key: 'category', text: '分类', iconKey: null, activeIconKey: null, link: { type: 'page', value: '/pages/category/index' } },
    { key: 'cart', text: '购物车', iconKey: null, activeIconKey: null, link: { type: 'page', value: '/pages/cart/index' } },
    { key: 'mine', text: '我的', iconKey: null, activeIconKey: null, link: { type: 'page', value: '/pages/mine/index' } },
  ],
};

test('微页面：编辑发布后小程序渲染，可设为首页并持久生效', async ({ page, request }) => {
  const token = await adminToken(request);
  const headers = { authorization: `Bearer ${token}` };
  const suffix = Date.now().toString(36).toUpperCase();
  let pageId = '';

  const list = await request.get(`${API}/admin/micro-pages?pageSize=100`, { headers });
  const originalHome = unwrap<{ items: { id: string; isHome: boolean }[] }>(await list.json()).items.find(
    (item) => item.isHome,
  );

  try {
    const created = await request.post(`${API}/admin/micro-pages`, {
      headers,
      data: { title: `E2E 微页面 ${suffix}` },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const detail = unwrap<{ id: string; code: string }>(await created.json());
    pageId = detail.id;

    const saved = await request.put(`${API}/admin/micro-pages/${pageId}`, {
      headers,
      data: {
        title: `E2E 微页面 ${suffix}`,
        settings: { shareTitle: `分享 ${suffix}`, bgColor: '#f6f4ef' },
        components: [
          {
            id: 'c-notice',
            type: 'notice',
            visible: true,
            style: { margin: [8, 12, 0, 12] },
            props: { text: `公告 ${suffix}`, tag: '包邮', scroll: false, speed: 80, link: { type: 'none', value: null } },
          },
          {
            id: 'c-search',
            type: 'search',
            visible: true,
            style: { margin: [8, 12, 0, 12] },
            props: { placeholder: `搜索 ${suffix}`, shape: 'capsule', showHotwords: false, hotwords: [], link: { type: 'none', value: null } },
          },
          {
            id: 'c-text',
            type: 'text',
            visible: true,
            style: { margin: [12, 12, 0, 12], padding: [12, 12, 12, 12], bgColor: '#ffffff', radius: 8 },
            props: {
              content: `E2E 文案 ${suffix}`,
              fontSize: 16,
              color: '#2f2a24',
              weight: 'bold',
              align: 'center',
              lineHeight: 1.5,
              maxLines: 0,
              link: { type: 'none', value: null },
            },
          },
          {
            id: 'c-goods',
            type: 'goods',
            visible: true,
            style: { margin: [12, 8, 0, 8] },
            props: {
              source: 'picks',
              productIds: [],
              categoryId: '',
              promotionId: '',
              limit: 2,
              layout: 'grid-2',
              show: { price: true, originPrice: true, sales: false, tag: false },
              buyButton: false,
              cardBg: '',
            },
          },
        ],
      },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();

    const published = await request.post(`${API}/admin/micro-pages/${pageId}/publish`, { headers });
    expect(published.ok(), await published.text()).toBeTruthy();

    // 小程序微页面渲染
    await page.goto(`${H5}/#/pages/micro/index?code=${detail.code}`);
    await expect(page.getByText(`E2E 文案 ${suffix}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(`公告 ${suffix}`)).toBeVisible();
    await expect(page.getByText(`搜索 ${suffix}`)).toBeVisible();
    await expect(page.locator('.app-tabbar')).toBeVisible();
    await expect(page.locator('.micro-goods-card').first()).toBeVisible();

    // 底部导航配置即时生效（改「分类」文案）
    const tabbar = {
      enabled: true,
      style: { selectedColor: '#E2231A', borderTop: true },
      items: DEFAULT_TABBAR.items.map((item) =>
        item.key === 'category' ? { ...item, text: '逛店' } : item,
      ),
    };
    const savedTabbar = await request.put(`${API}/admin/tabbar`, { headers, data: tabbar });
    expect(savedTabbar.ok(), await savedTabbar.text()).toBeTruthy();
    await page.goto(`${H5}/#/pages/home/index`);
    await expect(page.locator('.app-tabbar')).toContainText('逛店', { timeout: 30_000 });

    // 设为首页后首页直接渲染微页面，刷新后仍保持
    const home = await request.post(`${API}/admin/micro-pages/${pageId}/home`, { headers });
    expect(home.ok(), await home.text()).toBeTruthy();
    await page.goto(`${H5}/#/pages/home/index`);
    await expect(page.getByText(`E2E 文案 ${suffix}`)).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByText(`E2E 文案 ${suffix}`)).toBeVisible({ timeout: 30_000 });
  } finally {
    if (originalHome && originalHome.id !== pageId) {
      await request
        .post(`${API}/admin/micro-pages/${originalHome.id}/home`, { headers })
        .catch(() => undefined);
    }
    await request.put(`${API}/admin/tabbar`, { headers, data: DEFAULT_TABBAR }).catch(() => undefined);
    if (pageId) {
      await request.delete(`${API}/admin/micro-pages/${pageId}`, { headers }).catch(() => undefined);
    }
  }
});
