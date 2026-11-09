/**
 * 用户标签体系契约：两级标签 CRUD、批量打标、按标签筛选。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

let superToken = '';

async function api(path: string, init: RequestInit = {}, token = superToken) {
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

beforeAll(async () => {
  const admin = await api(
    '/admin/auth/login',
    { method: 'POST', body: JSON.stringify({ account: 'admin@shanye.com', password: 'admin123' }) },
    '',
  );
  superToken = admin.body.data.token;
});

afterAll(() => {
  superToken = '';
});

describe('用户标签契约', () => {
  it('两级标签可建可改，第三级被拒绝，批量打标可增删覆盖', async () => {
    const stamp = Date.now();
    const rootName = `价值分层${stamp}`;
    const childName = `高价值${stamp}`;

    const customers = await api('/admin/customers?page=1&pageSize=1');
    expect(customers.status).toBe(200);
    const userId = customers.body.data.items[0]?.id as string;
    expect(userId).toBeTruthy();

    const root = await api('/admin/user-tags', {
      method: 'POST',
      body: JSON.stringify({ name: rootName }),
    });
    expect(root.status).toBe(201);
    const rootId = root.body.data.id as string;

    const child = await api('/admin/user-tags', {
      method: 'POST',
      body: JSON.stringify({ name: childName, parentId: rootId }),
    });
    expect(child.status).toBe(201);
    const childId = child.body.data.id as string;

    // 同级重名 409
    const dup = await api('/admin/user-tags', {
      method: 'POST',
      body: JSON.stringify({ name: rootName }),
    });
    expect(dup.status).toBe(409);

    // 第三级 400
    const third = await api('/admin/user-tags', {
      method: 'POST',
      body: JSON.stringify({ name: `更深一层${stamp}`, parentId: childId }),
    });
    expect(third.status).toBe(400);

    // 追加标签
    const added = await api('/admin/customers/batch/tags', {
      method: 'POST',
      body: JSON.stringify({ userIds: [userId], tagIds: [childId], mode: 'add' }),
    });
    expect(added.status).toBe(200);
    expect(added.body.data).toMatchObject({ users: 1, tags: 1, mode: 'add' });

    // 按一级标签筛选能命中挂在二级标签上的客户
    const filtered = await api(`/admin/customers?tagId=${rootId}&page=1&pageSize=100`);
    expect(filtered.status).toBe(200);
    const hit = filtered.body.data.items.find((item: { id: string }) => item.id === userId);
    expect(hit).toBeTruthy();
    expect(hit.tags.some((tag: { id: string }) => tag.id === childId)).toBe(true);

    // 详情包含标签
    const detail = await api(`/admin/customers/${userId}`);
    expect(detail.body.data.tags.some((tag: { id: string }) => tag.id === childId)).toBe(true);

    // 移除
    const removed = await api('/admin/customers/batch/tags', {
      method: 'POST',
      body: JSON.stringify({ userIds: [userId], tagIds: [childId], mode: 'remove' }),
    });
    expect(removed.status).toBe(200);
    const afterRemove = await api(`/admin/customers/${userId}`);
    expect(afterRemove.body.data.tags.some((tag: { id: string }) => tag.id === childId)).toBe(false);

    // 覆盖（空标签清空）
    await api('/admin/customers/batch/tags', {
      method: 'POST',
      body: JSON.stringify({ userIds: [userId], tagIds: [rootId, childId], mode: 'replace' }),
    });
    const replaced = await api(`/admin/customers/${userId}`);
    expect(replaced.body.data.tags).toHaveLength(2);

    await api('/admin/customers/batch/tags', {
      method: 'POST',
      body: JSON.stringify({ userIds: [userId], tagIds: [], mode: 'replace' }),
    });
    const cleared = await api(`/admin/customers/${userId}`);
    expect(cleared.body.data.tags).toHaveLength(0);

    // 重命名
    const renamed = await api(`/admin/user-tags/${rootId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: `${rootName}改` }),
    });
    expect(renamed.status).toBe(200);

    // 删除一级标签级联删除二级
    const deleted = await api(`/admin/user-tags/${rootId}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    const tree = await api('/admin/user-tags');
    const names = (tree.body.data.items as { id: string; children?: { id: string }[] }[]).map(
      (item) => item.id,
    );
    expect(names).not.toContain(rootId);
    expect(names).not.toContain(childId);
  });

  it('空客户列表打标返回 400', async () => {
    const res = await api('/admin/customers/batch/tags', {
      method: 'POST',
      body: JSON.stringify({ userIds: [], tagIds: ['x'] }),
    });
    expect(res.status).toBe(400);
  });
});
