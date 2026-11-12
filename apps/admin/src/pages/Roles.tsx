import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError, formatDate } from '../api/client';
import { can } from '../auth';
import { confirmAction } from '../components/confirm';
import { toast } from '../components/toast';
import { Button, Card, DataTable, PageHeader, Toolbar, type Column } from '../components/ui';

interface RoleRow {
  id: string;
  name: string;
  description: string;
  permissionCount: number;
  memberCount: number;
  updatedAt: string;
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function Roles() {
  const navigate = useNavigate();
  const canWrite = can('role.manage');
  const [items, setItems] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');

  async function load() {
    setLoading(true);
    try {
      const result = await api<{ items: RoleRow[] }>('/admin/roles');
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

  async function remove(row: RoleRow) {
    if (row.memberCount > 0) {
      toast(`该角色下还有 ${row.memberCount} 个账号，请先调整账号角色`, 'error');
      return;
    }
    if (!(await confirmAction(`确定删除角色「${row.name}」吗？删除后不可恢复。`))) return;
    try {
      await api(`/admin/roles/${row.id}`, { method: 'DELETE' });
      toast('已删除');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  const columns: Column<RoleRow>[] = [
    {
      key: 'name',
      title: '角色名称',
      render: (row) => (
        <div>
          <strong>{row.name}</strong>
          {row.description && <div className="small muted">{row.description}</div>}
        </div>
      ),
    },
    {
      key: 'permissionCount',
      title: '权限数',
      render: (row) => <span className="mono">{row.permissionCount}</span>,
    },
    {
      key: 'memberCount',
      title: '成员数',
      render: (row) => <span className="mono">{row.memberCount}</span>,
    },
    {
      key: 'updatedAt',
      title: '更新时间',
      render: (row) => <span className="small mono">{formatDate(row.updatedAt)}</span>,
    },
    {
      key: 'actions',
      title: '操作',
      align: 'right',
      render: (row) => (
        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate(`/accounts/roles/${row.id}/edit`)}
          >
            编辑
          </Button>
          {canWrite && (
            <Button size="sm" variant="ghost" onClick={() => void remove(row)}>
              删除
            </Button>
          )}
        </div>
      ),
    },
  ];

  const applied = keyword.trim().toLowerCase();
  const filtered = applied
    ? items.filter(
        (item) =>
          item.name.toLowerCase().includes(applied) ||
          item.description.toLowerCase().includes(applied),
      )
    : items;

  return (
    <>
      <PageHeader
        title="角色"
        desc="自定义后台角色并勾选权限；子账号按角色获得菜单与操作权限"
        actions={
          canWrite ? (
            <Button onClick={() => navigate('/accounts/roles/new')}>新建角色</Button>
          ) : undefined
        }
      />

      <Card>
        <Toolbar>
          <input
            className="input"
            style={{ width: 240 }}
            aria-label="搜索角色"
            placeholder="搜索角色名称 / 描述…"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          {keyword && (
            <Button size="sm" variant="ghost" onClick={() => setKeyword('')}>
              清空
            </Button>
          )}
        </Toolbar>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          empty="还没有角色，先新建一个角色再分配给子账号"
        />
      </Card>
    </>
  );
}
