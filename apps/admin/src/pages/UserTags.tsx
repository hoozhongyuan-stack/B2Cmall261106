import { useEffect, useState } from 'react';

import { api, ApiError } from '../api/client';
import { can } from '../auth';
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
  type Column,
} from '../components/ui';

interface TagNode {
  id: string;
  name: string;
  parentId: string | null;
  sort: number;
  userCount: number;
  children?: TagNode[];
}

interface TagRow {
  id: string;
  name: string;
  depth: number;
  parentName: string | null;
  userCount: number;
  isRoot: boolean;
}

interface ModalState {
  open: boolean;
  editing: TagRow | null;
  parentId: string;
  parentName: string;
  name: string;
}

const CLOSED_MODAL: ModalState = {
  open: false,
  editing: null,
  parentId: '',
  parentName: '',
  name: '',
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function UserTags() {
  const canWrite = can('usertag.manage');
  const [tree, setTree] = useState<TagNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>(CLOSED_MODAL);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await api<{ items: TagNode[] }>('/admin/user-tags');
      setTree(result.items);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    const name = modal.name.trim();
    if (!name) {
      toast('请填写标签名称', 'error');
      return;
    }
    setSaving(true);
    try {
      if (modal.editing) {
        await api(`/admin/user-tags/${modal.editing.id}`, { method: 'PATCH', body: { name } });
      } else {
        await api('/admin/user-tags', {
          method: 'POST',
          body: { name, parentId: modal.parentId || undefined },
        });
      }
      toast('已保存');
      setModal(CLOSED_MODAL);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: TagRow) {
    const tip = row.isRoot
      ? `确定删除一级标签「${row.name}」吗？其下二级标签与客户绑定会一并移除。`
      : `确定删除标签「${row.name}」吗？客户身上的该标签会一并移除。`;
    if (!(await confirmAction(tip, { confirmText: '删除' }))) return;
    try {
      await api(`/admin/user-tags/${row.id}`, { method: 'DELETE' });
      toast('已删除');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  const rows: TagRow[] = tree.flatMap((root) => [
    {
      id: root.id,
      name: root.name,
      depth: 0,
      parentName: null,
      userCount: root.userCount,
      isRoot: true,
    },
    ...(root.children ?? []).map((child) => ({
      id: child.id,
      name: child.name,
      depth: 1,
      parentName: root.name,
      userCount: child.userCount,
      isRoot: false,
    })),
  ]);

  const columns: Column<TagRow>[] = [
    {
      key: 'name',
      title: '标签',
      render: (row) => (
        <div className="row" style={{ paddingLeft: row.depth * 24 }}>
          {row.depth > 0 && <span className="muted small">└</span>}
          <Tag tone={row.isRoot ? 'brand' : 'ok'}>{row.name}</Tag>
        </div>
      ),
    },
    {
      key: 'userCount',
      title: '覆盖客户',
      align: 'right',
      render: (row) => <span className="mono">{row.userCount}</span>,
    },
    {
      key: 'actions',
      title: '操作',
      align: 'right',
      render: (row) =>
        canWrite ? (
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
            {row.isRoot && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setModal({
                    open: true,
                    editing: null,
                    parentId: row.id,
                    parentName: row.name,
                    name: '',
                  })
                }
              >
                添加子标签
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setModal({
                  open: true,
                  editing: row,
                  parentId: '',
                  parentName: row.parentName ?? '',
                  name: row.name,
                })
              }
            >
              重命名
            </Button>
            <Button size="sm" variant="danger" onClick={() => void remove(row)}>
              删除
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="用户标签"
        desc="两级标签体系：一级做分类，二级做细分；标签可批量打到客户身上"
        actions={
          canWrite ? (
            <Button onClick={() => setModal({ ...CLOSED_MODAL, open: true })}>新建一级标签</Button>
          ) : undefined
        }
      />

      <Card
        title="标签树"
        extra={<span className="small muted">共 {rows.length} 个标签</span>}
      >
        <DataTable columns={columns} rows={rows} loading={loading} empty="还没有用户标签" />
      </Card>

      <Modal
        open={modal.open}
        title={modal.editing ? '重命名标签' : modal.parentId ? '新建二级标签' : '新建一级标签'}
        onClose={() => setModal(CLOSED_MODAL)}
        footer={
          <>
            <Button variant="plain" onClick={() => setModal(CLOSED_MODAL)}>
              取消
            </Button>
            <Button loading={saving} onClick={() => void save()}>
              保存
            </Button>
          </>
        }
      >
        {!modal.editing && (
          <Field label="上级标签">
            {modal.parentId ? (
              <input className="input" value={modal.parentName} disabled />
            ) : (
              <select
                className="select"
                value={modal.parentId}
                onChange={(event) => {
                  const parent = tree.find((item) => item.id === event.target.value);
                  setModal((prev) => ({
                    ...prev,
                    parentId: event.target.value,
                    parentName: parent?.name ?? '',
                  }));
                }}
              >
                <option value="">无（一级标签）</option>
                {tree.map((root) => (
                  <option key={root.id} value={root.id}>
                    {root.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field label="标签名称" hint="最多 20 个字，同级不可重名" required>
          <input
            className="input"
            value={modal.name}
            placeholder={modal.parentId ? '例如：高复购' : '例如：客户价值'}
            onChange={(event) => setModal((prev) => ({ ...prev, name: event.target.value }))}
          />
        </Field>
      </Modal>
    </>
  );
}
