import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  PERMISSION_DEPENDENCIES,
  PERMISSION_GROUPS,
  type PermissionKey,
} from '@shanye/shared/src/permissions';

import { api, ApiError } from '../api/client';
import { toast } from '../components/toast';
import { Button, Card, Field, PageHeader } from '../components/ui';

interface RoleDetail {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  memberCount: number;
}

/** 反向依赖：取消查看权限时，一并取消依赖它的写权限 */
const REVERSE_DEPENDENCIES = new Map<string, string[]>();
for (const [child, parents] of Object.entries(PERMISSION_DEPENDENCIES)) {
  for (const parent of parents ?? []) {
    const list = REVERSE_DEPENDENCIES.get(parent) ?? [];
    list.push(child);
    REVERSE_DEPENDENCIES.set(parent, list);
  }
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

const PERMISSION_TOTAL = PERMISSION_GROUPS.reduce((total, group) => total + group.items.length, 0);

function GroupCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="checkbox"
      checked={checked}
      aria-label={`全选${label}`}
      onChange={onChange}
    />
  );
}

export default function RoleEdit() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const editing = Boolean(id);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);

  useEffect(() => {
    if (!id) return;
    api<RoleDetail>(`/admin/roles/${id}`)
      .then((role) => {
        setName(role.name);
        setDescription(role.description);
        setPermissions(new Set(role.permissions));
      })
      .catch((err) => toast(errorText(err), 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  function togglePermission(key: PermissionKey) {
    setPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        for (const dependent of REVERSE_DEPENDENCIES.get(key) ?? []) next.delete(dependent);
      } else {
        next.add(key);
        for (const dependency of PERMISSION_DEPENDENCIES[key] ?? []) next.add(dependency);
      }
      return next;
    });
  }

  function toggleGroup(keys: PermissionKey[]) {
    setPermissions((prev) => {
      const next = new Set(prev);
      const allSelected = keys.every((key) => next.has(key));
      if (allSelected) {
        for (const key of keys) {
          next.delete(key);
          for (const dependent of REVERSE_DEPENDENCIES.get(key) ?? []) next.delete(dependent);
        }
      } else {
        for (const key of keys) {
          next.add(key);
          for (const dependency of PERMISSION_DEPENDENCIES[key] ?? []) next.add(dependency);
        }
      }
      return next;
    });
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      toast('请填写角色名称', 'error');
      return;
    }
    if (!description.trim()) {
      toast('请填写角色描述', 'error');
      return;
    }
    if (!permissions.size) {
      toast('请至少选择一项权限', 'error');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim(),
        permissions: [...permissions],
      };
      if (editing && id) {
        await api(`/admin/roles/${id}`, { method: 'PATCH', body });
      } else {
        await api('/admin/roles', { method: 'POST', body });
      }
      toast('角色已保存');
      navigate('/accounts/roles');
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title={editing ? '编辑角色' : '新建角色'} />
        <div className="table-loading">加载中…</div>
      </>
    );
  }

  const term = keyword.trim().toLowerCase();
  const visibleGroups = PERMISSION_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (onlySelected && !permissions.has(item.key)) return false;
      if (!term) return true;
      return (
        item.name.toLowerCase().includes(term) || item.key.toLowerCase().includes(term)
      );
    }),
  })).filter((group) => group.items.length > 0);

  return (
    <form className="role-editor" onSubmit={handleSave}>
      <PageHeader
        title={editing ? '编辑角色' : '新建角色'}
        desc="角色权限决定子账号能看到哪些菜单、能执行哪些操作"
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Button type="button" variant="plain" onClick={() => navigate('/accounts/roles')}>
              取消
            </Button>
            <Button type="submit" loading={saving}>
              保存角色
            </Button>
          </div>
        }
      />

      <Card title="基础信息">
        <Field label="角色名称" required hint="最多 20 个字">
          <input
            className="input"
            value={name}
            maxLength={20}
            placeholder="例如：客服主管"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="角色描述" required hint="最多 200 个字，说明该角色的职责">
          <textarea
            className="input"
            rows={4}
            maxLength={200}
            value={description}
            placeholder="例如：负责售后审核、客户咨询与评价回复"
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </Card>

      <Card
        title="角色权限"
        extra={<span className="small muted">已选 {permissions.size} 项</span>}
      >
        <div className="row perm-toolbar">
          <input
            className="input"
            style={{ width: 260 }}
            placeholder="搜索权限名称或标识…"
            aria-label="搜索权限"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <label className="row small muted" style={{ gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              className="checkbox"
              checked={onlySelected}
              onChange={(event) => setOnlySelected(event.target.checked)}
            />
            仅看已选
          </label>
          <span className="small muted">共 {PERMISSION_TOTAL} 项权限</span>
        </div>

        <div className="perm-groups">
          {visibleGroups.length === 0 ? (
            <div className="empty">没有匹配的权限</div>
          ) : (
            visibleGroups.map((group) => {
              const keys = group.items.map((item) => item.key);
              const count = keys.filter((key) => permissions.has(key)).length;
              const all = count === keys.length;
              const some = count > 0 && !all;
              return (
                <section key={group.key} className="perm-group">
                  <header className="perm-group-head">
                    <label className="row" style={{ gap: 8 }}>
                      <GroupCheckbox
                        checked={all}
                        indeterminate={some}
                        onChange={() => toggleGroup(keys as PermissionKey[])}
                        label={group.name}
                      />
                      <strong>{group.name}</strong>
                    </label>
                    <span className="small muted">
                      已选 {count}/{keys.length}
                    </span>
                  </header>
                  <div className="perm-grid">
                    {group.items.map((item) => (
                      <label key={item.key} className="perm-item">
                        <input
                          type="checkbox"
                          className="checkbox"
                          checked={permissions.has(item.key)}
                          onChange={() => togglePermission(item.key)}
                        />
                        <span>{item.name}</span>
                      </label>
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </Card>

      <div className="row-between role-save">
        <span className="small muted">
          勾选写权限会自动补齐对应的查看权限；取消查看权限会同时取消相关写权限。
        </span>
        <div className="row" style={{ gap: 8 }}>
          <Button type="button" variant="plain" onClick={() => navigate('/accounts/roles')}>
            取消
          </Button>
          <Button type="submit" loading={saving}>
            保存角色
          </Button>
        </div>
      </div>
    </form>
  );
}
