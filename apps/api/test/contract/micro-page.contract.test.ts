/**
 * 微页面装修契约：草稿/发布隔离、组件校验、删除保护、底部导航与首页切换。
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

async function api(path: string, init: RequestInit = {}, token = '') {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

let admin = '';
let categoryId = '';
let productId = '';

const textComponent = (content: string) => ({
  id: `cmp-${Math.random().toString(36).slice(2, 8)}`,
  type: 'text',
  visible: true,
  style: { margin: [8, 12, 8, 12] },
  props: {
    content,
    fontSize: 14,
    color: '#2f2a24',
    weight: 'normal',
    align: 'left',
    lineHeight: 1.5,
    maxLines: 0,
    link: { type: 'none', value: null },
  },
});

async function createPage(title: string): Promise<{ id: string; code: string }> {
  const res = await api('/admin/micro-pages', { method: 'POST', body: JSON.stringify({ title }) }, admin);
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  return res.body.data as { id: string; code: string };
}

beforeAll(async () => {
  const login = await api('/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account: 'admin@shanye.com', password: 'admin123' }),
  });
  expect(login.status).toBe(200);
  admin = login.body.data.token as string;

  const categories = await api('/categories');
  categoryId = categories.body.data[0]?.id as string;
  const products = await api('/products?pageSize=1');
  productId = products.body.data.items[0]?.id as string;
  expect(categoryId && productId).toBeTruthy();
});

describe('微页面：草稿与发布', () => {
  it('草稿可保存未填完的组件，上线前公开接口不可见', async () => {
    const page = await createPage('契约页面 A');

    // 轮播未选图片：草稿允许保存
    const draft = await api(
      `/admin/micro-pages/${page.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          components: [
            { id: 'b1', type: 'banner', visible: true, style: {}, props: { items: [], ratio: '2:1' } },
          ],
        }),
      },
      admin,
    );
    expect(draft.status).toBe(200);

    const before = await api(`/micro-pages/${page.code}`);
    expect(before.status).toBe(404);

    // 上线时严格校验，未填完的轮播被拒绝
    const reject = await api(`/admin/micro-pages/${page.id}/publish`, { method: 'POST' }, admin);
    expect(reject.status).toBe(400);

    await api(
      `/admin/micro-pages/${page.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({ components: [textComponent('第一版文案')] }),
      },
      admin,
    );
    const published = await api(`/admin/micro-pages/${page.id}/publish`, { method: 'POST' }, admin);
    expect(published.status).toBe(200);
    expect(published.body.data.version).toBe(1);

    const online = await api(`/micro-pages/${page.code}`);
    expect(online.status).toBe(200);
    expect(online.body.data.components).toHaveLength(1);
    expect(online.body.data.components[0].props.content).toBe('第一版文案');

    // 再改草稿，线上仍是旧快照
    await api(
      `/admin/micro-pages/${page.id}`,
      { method: 'PUT', body: JSON.stringify({ components: [textComponent('第二版文案')] }) },
      admin,
    );
    const stale = await api(`/micro-pages/${page.code}`);
    expect(stale.body.data.components[0].props.content).toBe('第一版文案');

    const next = await api(`/admin/micro-pages/${page.id}/publish`, { method: 'POST' }, admin);
    expect(next.body.data.version).toBe(2);
    const fresh = await api(`/micro-pages/${page.code}`);
    expect(fresh.body.data.components[0].props.content).toBe('第二版文案');

    // 回滚到上一版
    const rollback = await api(`/admin/micro-pages/${page.id}/rollback`, { method: 'POST' }, admin);
    expect(rollback.status).toBe(200);
    const rolled = await api(`/micro-pages/${page.code}`);
    expect(rolled.body.data.components[0].props.content).toBe('第一版文案');
  });

  it('组件白名单与链接校验生效', async () => {
    const page = await createPage('契约页面 B');

    const unknown = await api(
      `/admin/micro-pages/${page.id}`,
      { method: 'PUT', body: JSON.stringify({ components: [{ type: 'marquee', props: {} }] }) },
      admin,
    );
    expect(unknown.status).toBe(400);

    const badLink = await api(
      `/admin/micro-pages/${page.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          components: [
            {
              ...textComponent('带链接'),
              props: {
                ...textComponent('带链接').props,
                link: { type: 'product', value: 'not-exist' },
              },
            },
          ],
        }),
      },
      admin,
    );
    expect(badLink.status).toBe(400);

    const goodLink = await api(
      `/admin/micro-pages/${page.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          components: [
            {
              ...textComponent('带链接'),
              props: {
                ...textComponent('带链接').props,
                link: { type: 'product', value: productId },
              },
            },
          ],
        }),
      },
      admin,
    );
    expect(goodLink.status).toBe(200);

    const pageLink = await api(
      `/admin/link-options?type=page&limit=20`,
      {},
      admin,
    );
    expect(pageLink.status).toBe(200);
    expect(pageLink.body.data.items.some((item: { value: string }) => item.value === '/pages/home/index')).toBe(true);
  });

  it('并发保存返回 409', async () => {
    const page = await createPage('契约页面 C');
    const detail = await api(`/admin/micro-pages/${page.id}`, {}, admin);
    const stale = detail.body.data.updatedAt as string;

    await api(
      `/admin/micro-pages/${page.id}`,
      { method: 'PUT', body: JSON.stringify({ title: '契约页面 C1' }) },
      admin,
    );
    const conflict = await api(
      `/admin/micro-pages/${page.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({ title: '契约页面 C2', expectedUpdatedAt: stale }),
      },
      admin,
    );
    expect(conflict.status).toBe(409);
  });
});

describe('微页面：首页与删除保护', () => {
  it('未上线不能设为首页；上线后切换 shell，并可回退旧版', async () => {
    const page = await createPage('契约首页');
    const early = await api(`/admin/micro-pages/${page.id}/home`, { method: 'POST' }, admin);
    expect(early.status).toBe(400);

    await api(
      `/admin/micro-pages/${page.id}`,
      { method: 'PUT', body: JSON.stringify({ components: [textComponent('首页文案')] }) },
      admin,
    );
    await api(`/admin/micro-pages/${page.id}/publish`, { method: 'POST' }, admin);

    const home = await api(`/admin/micro-pages/${page.id}/home`, { method: 'POST' }, admin);
    expect(home.status).toBe(200);

    const shell = await api('/shop/shell');
    expect(shell.body.data.homeRenderer).toBe('micro');
    expect(shell.body.data.homeCode).toBe(page.code);

    const reset = await api(`/admin/micro-pages/${page.id}/home`, { method: 'DELETE' }, admin);
    expect(reset.status).toBe(200);
    const legacy = await api('/shop/shell');
    expect(legacy.body.data.homeRenderer).toBe('legacy');
    expect(legacy.body.data.homeCode).toBeNull();
  });

  it('被底部导航或其他页面引用时禁止删除', async () => {
    const target = await createPage('被引用页面');
    await api(
      `/admin/micro-pages/${target.id}`,
      { method: 'PUT', body: JSON.stringify({ components: [textComponent('目标')] }) },
      admin,
    );
    await api(`/admin/micro-pages/${target.id}/publish`, { method: 'POST' }, admin);

    // 另一个页面链接到目标
    const source = await createPage('引用页面');
    await api(
      `/admin/micro-pages/${source.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          components: [
            {
              ...textComponent('去目标页'),
              props: {
                ...textComponent('去目标页').props,
                link: { type: 'micro', value: target.code },
              },
            },
          ],
        }),
      },
      admin,
    );

    const blocked = await api(`/admin/micro-pages/${target.id}`, { method: 'DELETE' }, admin);
    expect(blocked.status).toBe(400);
    expect(String(blocked.body.message)).toContain('引用页面');

    await api(`/admin/micro-pages/${source.id}`, { method: 'DELETE' }, admin);
    const ok = await api(`/admin/micro-pages/${target.id}`, { method: 'DELETE' }, admin);
    expect(ok.status).toBe(200);
  });

  it('底部导航 2~5 个入口且必须包含首页', async () => {
    const onlyOne = await api(
      '/admin/tabbar',
      {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          style: {},
          items: [{ key: 'home', text: '首页', link: { type: 'page', value: '/pages/home/index' } }],
        }),
      },
      admin,
    );
    expect(onlyOne.status).toBe(400);

    const noHome = await api(
      '/admin/tabbar',
      {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          style: {},
          items: [
            { key: 'a', text: '分类', link: { type: 'page', value: '/pages/category/index' } },
            { key: 'b', text: '购物车', link: { type: 'page', value: '/pages/cart/index' } },
          ],
        }),
      },
      admin,
    );
    expect(noHome.status).toBe(400);

    const saved = await api(
      '/admin/tabbar',
      {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          style: { selectedColor: '#E2231A', borderTop: true },
          items: [
            { key: 'home', text: '首页', link: { type: 'page', value: '/pages/home/index' } },
            { key: 'category', text: '分类', link: { type: 'page', value: '/pages/category/index' } },
            { key: 'cart', text: '购物车', link: { type: 'page', value: '/pages/cart/index' } },
            { key: 'mine', text: '我的', link: { type: 'page', value: '/pages/mine/index' } },
          ],
        }),
      },
      admin,
    );
    expect(saved.status).toBe(200);
    expect(saved.body.data.items).toHaveLength(4);

    const shell = await api('/shop/shell');
    expect(shell.body.data.tabbar.items[0].key).toBe('home');
  });
});

describe('微页面：老首页迁移', () => {
  it('迁移可重复执行，生成已发布的 home 页面', async () => {
    const first = await api('/admin/micro-pages/migrate-home', { method: 'POST' }, admin);
    expect(first.status).toBe(200);
    expect(first.body.data.created).toBe(true);

    const second = await api('/admin/micro-pages/migrate-home', { method: 'POST' }, admin);
    expect(second.status).toBe(200);
    expect(second.body.data.created).toBe(false);

    const online = await api('/micro-pages/home');
    expect(online.status).toBe(200);
    expect(online.body.data.components.length).toBeGreaterThan(0);
  });
});
