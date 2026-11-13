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

async function login(account: string, password: string): Promise<string> {
  const res = await api('/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account, password }),
  });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

describe('圈子类目、话题与设置', () => {
  let token = '';
  let categoryId = '';
  let topicId = '';

  beforeAll(async () => {
    token = await login('admin@shanye.com', 'admin123');
  });

  it('默认带出类目、话题与设置', async () => {
    const categories = await api('/admin/circle/categories', {}, token);
    expect(categories.status).toBe(200);
    expect(categories.body.data.items.length).toBeGreaterThan(0);

    const topics = await api('/admin/circle/topics', {}, token);
    expect(topics.status).toBe(200);
    expect(topics.body.data.items.length).toBeGreaterThan(0);

    const settings = await api('/admin/circle/settings', {}, token);
    expect(settings.status).toBe(200);
    expect(settings.body.data.auditMode).toMatch(/HYBRID|REVIEW/);
  });

  it('可创建、编辑与启停类目', async () => {
    const name = `契约类目${Date.now()}`;
    const created = await api(
      '/admin/circle/categories',
      { method: 'POST', body: JSON.stringify({ name, sort: 99 }) },
      token,
    );
    expect(created.status).toBe(201);
    categoryId = created.body.data.id;
    expect(created.body.data.enabled).toBe(true);

    const updated = await api(
      `/admin/circle/categories/${categoryId}`,
      { method: 'PATCH', body: JSON.stringify({ name: `${name}-改`, enabled: false, sort: 98 }) },
      token,
    );
    expect(updated.status).toBe(200);
    expect(updated.body.data.enabled).toBe(false);

    const list = await api('/admin/circle/categories', {}, token);
    const row = list.body.data.items.find((item: { id: string }) => item.id === categoryId);
    expect(row.name).toBe(`${name}-改`);
    expect(row.postCount).toBe(0);
  });

  it('可创建话题并绑定类目', async () => {
    const name = `契约话题${Date.now()}`;
    const created = await api(
      '/admin/circle/topics',
      {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: '契约测试话题',
          categoryId,
          pinned: true,
          sort: 1,
        }),
      },
      token,
    );
    expect(created.status).toBe(201);
    topicId = created.body.data.id;

    const list = await api('/admin/circle/topics', {}, token);
    const row = list.body.data.items.find((item: { id: string }) => item.id === topicId);
    expect(row.name).toBe(name);
    expect(row.categoryId).toBe(categoryId);
    expect(row.categoryName).toContain('改');
    expect(row.pinned).toBe(true);
    expect(row.postCount).toBe(0);
  });

  it('结束时间早于开始时间返回 400', async () => {
    const res = await api(
      '/admin/circle/topics',
      {
        method: 'POST',
        body: JSON.stringify({
          name: `非法时间${Date.now()}`,
          startAt: '2026-12-02T10:00:00.000Z',
          endAt: '2026-12-01T10:00:00.000Z',
        }),
      },
      token,
    );
    expect(res.status).toBe(400);
  });

  it('可保存圈子设置', async () => {
    const before = await api('/admin/circle/settings', {}, token);
    const updated = await api(
      '/admin/circle/settings',
      {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: true,
          auditMode: 'REVIEW',
          dailyPostLimit: 6,
          dailyCommentLimit: 40,
          postPoints: 12,
          postPointsDailyLimit: 2,
        }),
      },
      token,
    );
    expect(updated.status).toBe(200);
    expect(updated.body.data.auditMode).toBe('REVIEW');
    expect(updated.body.data.dailyPostLimit).toBe(6);

    // 恢复原值，避免影响其他用例
    await api(
      '/admin/circle/settings',
      {
        method: 'PATCH',
        body: JSON.stringify({
          auditMode: before.body.data.auditMode,
          dailyPostLimit: before.body.data.dailyPostLimit,
          dailyCommentLimit: before.body.data.dailyCommentLimit,
          postPoints: before.body.data.postPoints,
          postPointsDailyLimit: before.body.data.postPointsDailyLimit,
        }),
      },
      token,
    );
  });

  it('运营角色默认可查看圈子', async () => {
    const opsToken = await login('ops@shanye.com', 'ops12345');
    const res = await api('/admin/circle/categories', {}, opsToken);
    expect(res.status).toBe(200);
  });

  it('清理测试话题与类目', async () => {
    const removedTopic = await api(`/admin/circle/topics/${topicId}`, { method: 'DELETE' }, token);
    expect(removedTopic.status).toBe(200);
    const removedCategory = await api(
      `/admin/circle/categories/${categoryId}`,
      { method: 'DELETE' },
      token,
    );
    expect(removedCategory.status).toBe(200);
  });
});
