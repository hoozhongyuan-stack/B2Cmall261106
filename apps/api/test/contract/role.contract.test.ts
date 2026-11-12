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

async function loginAdmin(): Promise<string> {
  const res = await api('/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account: 'admin@shanye.com', password: 'admin123' }),
  });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

describe('角色与权限契约', () => {
  let superToken = '';
  let roleId = '';
  let accountToken = '';

  beforeAll(async () => {
    superToken = await loginAdmin();
  });

  it('超管可创建角色并自动补齐查看权限', async () => {
    const created = await api(
      '/admin/roles',
      {
        method: 'POST',
        body: JSON.stringify({
          name: `契约角色${Date.now()}`,
          description: '只允许查看订单与发货',
          permissions: ['order.ship'],
        }),
      },
      superToken,
    );
    expect(created.status).toBe(201);
    roleId = created.body.data.id;
    expect(created.body.data.permissions).toContain('order.view');
    expect(created.body.data.permissions).toContain('order.ship');

    const list = await api('/admin/roles', {}, superToken);
    expect(list.status).toBe(200);
    expect(list.body.data.items.some((item: { id: string }) => item.id === roleId)).toBe(true);
  });

  it('未知权限返回 400', async () => {
    const res = await api(
      '/admin/roles',
      {
        method: 'POST',
        body: JSON.stringify({
          name: `非法角色${Date.now()}`,
          description: '包含未知权限',
          permissions: ['order.unknown'],
        }),
      },
      superToken,
    );
    expect(res.status).toBe(400);
  });

  it('按角色授权后接口按权限放行与拒绝', async () => {
    const account = `role-${Date.now()}@shanye.com`;
    const password = 'role123456';
    const created = await api(
      '/admin/accounts',
      {
        method: 'POST',
        body: JSON.stringify({
          account,
          displayName: '契约角色账号',
          kind: 'PC',
          roleId,
          password,
        }),
      },
      superToken,
    );
    expect(created.status).toBe(201);

    const login = await api('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ account, password }),
    });
    expect(login.status).toBe(200);
    accountToken = login.body.data.token;
    expect(login.body.data.user.role.id).toBe(roleId);
    expect(login.body.data.user.permissions).toContain('order.view');
    expect(login.body.data.user.permissions).not.toContain('product.view');

    const orders = await api('/admin/orders?pageSize=1', {}, accountToken);
    expect(orders.status).toBe(200);

    const products = await api('/admin/products?pageSize=1', {}, accountToken);
    expect(products.status).toBe(403);
    expect(products.body.message).toContain('缺少权限');

    const roles = await api('/admin/roles', {}, accountToken);
    expect(roles.status).toBe(403);
  });

  it('角色仍有账号时不可删除，调整后可删除', async () => {
    const blocked = await api(`/admin/roles/${roleId}`, { method: 'DELETE' }, superToken);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain('账号');
  });

  it('超管不受角色权限限制', async () => {
    const res = await api('/admin/roles', {}, superToken);
    expect(res.status).toBe(200);
  });
});
