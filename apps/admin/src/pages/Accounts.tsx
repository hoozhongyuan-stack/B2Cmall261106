import { useEffect, useState, type FormEvent } from 'react';

import { api, ApiError, formatDate } from '../api/client';
import { hasRole, ROLE_LABEL, type AdminRole } from '../auth';
import { confirmAction } from '../components/confirm';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  Field,
  Modal,
  PageHeader,
  Tag,
  Toolbar,
  type Column,
} from '../components/ui';

interface AccountRow {
  id: string;
  account: string;
  displayName: string;
  role: string;
  storeIds?: string[];
  status: string;
  failCount: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

interface StoreOption {
  id: string;
  name: string;
}

const ROLES: AdminRole[] = ['SUPER', 'OPS', 'CS', 'WMS'];
const EMPTY_CREATE = {
  account: '',
  displayName: '',
  role: 'CS' as AdminRole,
  password: '',
  storeIds: [] as string[],
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function Accounts() {
  const canWrite = hasRole('SUPER');
  const [items, setItems] = useState<AccountRow[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE);
  const [creating, setCreating] = useState(false);
  const [resetTarget, setResetTarget] = useState<AccountRow | null>(null);
  const [password, setPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [bindTarget, setBindTarget] = useState<AccountRow | null>(null);
  const [bindStoreIds, setBindStoreIds] = useState<string[]>([]);
  const [binding, setBinding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [result, storeResult] = await Promise.all([
        api<{ items: AccountRow[] }>('/admin/accounts'),
        canWrite
          ? api<{ items: StoreOption[] }>('/admin/stores', {
              query: { status: 'ACTIVE', pageSize: 200 },
            })
          : Promise.resolve({ items: [] as StoreOption[] }),
      ]);
      setItems(result.items);
      setStores(storeResult.items);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      toast('只有超级管理员可以新建子账号', 'error');
      return;
    }
    if (!createForm.account.trim() || !createForm.displayName.trim()) {
      toast('请填写账号与昵称', 'error');
      return;
    }
    if (createForm.password.length < 8) {
      toast('密码至少 8 位', 'error');
      return;
    }
    if (createForm.role === 'STORE' && !createForm.storeIds.length) {
      toast('门店账号至少绑定一个门店', 'error');
      return;
    }
    setCreating(true);
    try {
      await api('/admin/accounts', {
        method: 'POST',
        body: {
          account: createForm.account.trim(),
          displayName: createForm.displayName.trim(),
          role: createForm.role,
          password: createForm.password,
          ...(createForm.role === 'STORE' ? { storeIds: createForm.storeIds } : {}),
        },
      });
      toast('已保存');
      setCreateOpen(false);
      setCreateForm(EMPTY_CREATE);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setCreating(false);
    }
  }

  async function toggleStatus(row: AccountRow) {
    const next = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    const label = next === 'ACTIVE' ? '启用' : '停用';
    if (!(await confirmAction(`确定${label}账号「${row.account}」吗？`))) return;
    try {
      await api(`/admin/accounts/${row.id}/status`, { method: 'POST', body: { status: next } });
      toast('已保存');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function resetPassword() {
    if (!resetTarget) return;
    if (password.length < 8) {
      toast('密码至少 8 位', 'error');
      return;
    }
    setResetting(true);
    try {
      await api(`/admin/accounts/${resetTarget.id}/reset-password`, {
        method: 'POST',
        body: { password },
      });
      toast('密码已重置');
      setResetTarget(null);
      setPassword('');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setResetting(false);
    }
  }

  function openBind(row: AccountRow) {
    setBindTarget(row);
    setBindStoreIds(row.storeIds ?? []);
  }

  async function bindStores() {
    if (!bindTarget) return;
    if (!bindStoreIds.length) {
      toast('门店账号至少绑定一个门店', 'error');
      return;
    }
    setBinding(true);
    try {
      await api(`/admin/accounts/${bindTarget.id}`, {
        method: 'PATCH',
        body: { storeIds: bindStoreIds },
      });
      toast('已更新门店绑定');
      setBindTarget(null);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBinding(false);
    }
  }

  function storeNames(storeIds?: string[]): string {
    if (!storeIds?.length) return '未绑定';
    return storeIds
      .map((id) => stores.find((store) => store.id === id)?.name ?? id)
      .join('、');
  }

  const columns: Column<AccountRow>[] = [
    {
      key: 'account',
      title: '账号',
      render: (row) => (
        <div>
          <div className="mono">{row.account}</div>
          <div className="small muted">{row.displayName}</div>
        </div>
      ),
    },
    {
      key: 'role',
      title: '角色',
      render: (row) => <Tag tone="brand">{ROLE_LABEL[row.role as AdminRole] ?? row.role}</Tag>,
    },
    {
      key: 'stores',
      title: '绑定门店',
      render: (row) =>
        row.role === 'STORE' ? (
          <span className="small">{storeNames(row.storeIds)}</span>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      key: 'status',
      title: '状态',
      render: (row) => (
        <Tag tone={row.status === 'ACTIVE' ? 'ok' : 'danger'}>
          {row.status === 'ACTIVE' ? '启用' : '停用'}
        </Tag>
      ),
    },
    {
      key: 'lastLoginAt',
      title: '最近登录',
      render: (row) => <span className="small mono">{formatDate(row.lastLoginAt)}</span>,
    },
    {
      key: 'lockedUntil',
      title: '锁定至',
      render: (row) => <span className="small mono">{formatDate(row.lockedUntil)}</span>,
    },
    {
      key: 'createdAt',
      title: '创建时间',
      render: (row) => <span className="small mono">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'actions',
      title: '操作',
      align: 'right',
      render: (row) =>
        canWrite ? (
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
            {row.role === 'STORE' && (
              <Button size="sm" variant="ghost" onClick={() => openBind(row)}>
                绑定门店
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void toggleStatus(row)}>
              {row.status === 'ACTIVE' ? '停用' : '启用'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setResetTarget(row);
                setPassword('');
              }}
            >
              重置密码
            </Button>
          </div>
        ) : null,
    },
  ];

  const applied = keyword.trim().toLowerCase();
  const filteredItems = applied
    ? items.filter(
        (item) =>
          item.account.toLowerCase().includes(applied) ||
          item.displayName.toLowerCase().includes(applied),
      )
    : items;

  return (
    <>
      <PageHeader
        title="子账号"
        desc="按角色分配后台权限，停用后立即无法登录"
        actions={canWrite ? <Button onClick={() => setCreateOpen(true)}>新建子账号</Button> : undefined}
      />

      <Card>
        <Toolbar>
          <input
            className="input"
            style={{ width: 240 }}
            aria-label="搜索子账号"
            placeholder="搜索账号 / 姓名…"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          {keyword && (
            <Button size="sm" variant="ghost" onClick={() => setKeyword('')}>
              清空
            </Button>
          )}
        </Toolbar>
        <DataTable columns={columns} rows={filteredItems} loading={loading} empty="还没有子账号" />
      </Card>

      <Modal
        open={createOpen}
        title="新建子账号"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="plain" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button type="submit" form="account-create" loading={creating}>
              保存
            </Button>
          </>
        }
      >
        <form
          id="account-create"
          onSubmit={createAccount}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <Field label="登录账号">
            <input
              className="input"
              value={createForm.account}
              placeholder="例如：ops02@shanye.com"
              onChange={(e) => setCreateForm((prev) => ({ ...prev, account: e.target.value }))}
            />
          </Field>
          <Field label="显示昵称">
            <input
              className="input"
              value={createForm.displayName}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, displayName: e.target.value }))}
            />
          </Field>
          <Field label="角色">
            <select
              className="select"
              value={createForm.role}
              onChange={(e) => {
                const role = e.target.value as AdminRole;
                setCreateForm((prev) => ({
                  ...prev,
                  role,
                  storeIds: role === 'STORE' ? prev.storeIds : [],
                }));
              }}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </Field>
          {createForm.role === 'STORE' && (
            <Field label="绑定门店" hint="至少选择一个，可多选">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stores.map((store) => (
                  <label key={store.id} className="row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={createForm.storeIds.includes(store.id)}
                      onChange={(e) =>
                        setCreateForm((prev) => ({
                          ...prev,
                          storeIds: e.target.checked
                            ? [...prev.storeIds, store.id]
                            : prev.storeIds.filter((id) => id !== store.id),
                        }))
                      }
                    />
                    <span className="small">{store.name}</span>
                  </label>
                ))}
                {!stores.length && (
                  <span className="small muted">暂无启用门店，请先在门店管理中创建</span>
                )}
              </div>
            </Field>
          )}
          <Field label="初始密码" hint="至少 8 位">
            <input
              className="input"
              type="password"
              value={createForm.password}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, password: e.target.value }))}
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(bindTarget)}
        title={`绑定门店${bindTarget ? ` · ${bindTarget.account}` : ''}`}
        onClose={() => setBindTarget(null)}
        footer={
          <>
            <Button variant="plain" onClick={() => setBindTarget(null)}>
              取消
            </Button>
            <Button loading={binding} onClick={() => void bindStores()}>
              保存
            </Button>
          </>
        }
      >
        <Field label="门店" hint="至少选择一个，可多选">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stores.map((store) => (
              <label key={store.id} className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={bindStoreIds.includes(store.id)}
                  onChange={(e) =>
                    setBindStoreIds((prev) =>
                      e.target.checked
                        ? [...prev, store.id]
                        : prev.filter((id) => id !== store.id),
                    )
                  }
                />
                <span className="small">{store.name}</span>
              </label>
            ))}
          </div>
        </Field>
      </Modal>

      <Modal
        open={Boolean(resetTarget)}
        title={`重置密码${resetTarget ? ` · ${resetTarget.account}` : ''}`}
        onClose={() => setResetTarget(null)}
        footer={
          <>
            <Button variant="plain" onClick={() => setResetTarget(null)}>
              取消
            </Button>
            <Button loading={resetting} onClick={() => void resetPassword()}>
              确认重置
            </Button>
          </>
        }
      >
        <Field label="新密码" hint="至少 8 位，重置后会解除登录锁定">
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      </Modal>
    </>
  );
}
