import { useEffect, useState, type FormEvent } from 'react';

import { api, ApiError, formatDate } from '../api/client';
import { hasRole, ROLE_LABEL, type AdminRole } from '../auth';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  Field,
  Modal,
  PageHeader,
  Tag,
  type Column,
} from '../components/ui';

interface AccountRow {
  id: string;
  account: string;
  displayName: string;
  role: string;
  status: string;
  failCount: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

const ROLES: AdminRole[] = ['SUPER', 'OPS', 'CS', 'WMS'];
const EMPTY_CREATE = { account: '', displayName: '', role: 'CS' as AdminRole, password: '' };

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function Accounts() {
  const canWrite = hasRole('SUPER');
  const [items, setItems] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE);
  const [creating, setCreating] = useState(false);
  const [resetTarget, setResetTarget] = useState<AccountRow | null>(null);
  const [password, setPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await api<{ items: AccountRow[] }>('/admin/accounts');
      setItems(result.items);
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
    setCreating(true);
    try {
      await api('/admin/accounts', {
        method: 'POST',
        body: {
          account: createForm.account.trim(),
          displayName: createForm.displayName.trim(),
          role: createForm.role,
          password: createForm.password,
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
    if (!window.confirm(`确定${label}账号「${row.account}」吗？`)) return;
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

  return (
    <>
      <PageHeader
        title="子账号"
        desc="按角色分配后台权限，停用后立即无法登录"
        actions={canWrite ? <Button onClick={() => setCreateOpen(true)}>新建子账号</Button> : undefined}
      />

      <Card>
        <DataTable columns={columns} rows={items} loading={loading} empty="还没有子账号" />
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
              onChange={(e) =>
                setCreateForm((prev) => ({ ...prev, role: e.target.value as AdminRole }))
              }
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </Field>
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
