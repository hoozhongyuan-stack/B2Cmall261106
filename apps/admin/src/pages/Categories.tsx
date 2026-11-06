import { useEffect, useState, type FormEvent } from 'react';

import { api, ApiError } from '../api/client';
import { hasRole } from '../auth';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  Field,
  Modal,
  PageHeader,
  type Column,
} from '../components/ui';

interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  sort: number;
  productCount: number;
  children: CategoryNode[];
}

interface FlatRow {
  id: string;
  name: string;
  parentId: string | null;
  sort: number;
  productCount: number;
  isChild: boolean;
  hasChildren: boolean;
}

interface ModalState {
  open: boolean;
  editing: FlatRow | null;
  name: string;
  parentId: string;
  sort: string;
}

const CLOSED_MODAL: ModalState = { open: false, editing: null, name: '', parentId: '', sort: '0' };

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function Categories() {
  const canWrite = hasRole('SUPER', 'OPS');
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>(CLOSED_MODAL);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await api<CategoryNode[]>('/admin/categories');
      setTree(result);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const rows: FlatRow[] = [];
  for (const root of tree) {
    rows.push({
      id: root.id,
      name: root.name,
      parentId: root.parentId,
      sort: root.sort,
      productCount: root.productCount,
      isChild: false,
      hasChildren: (root.children ?? []).length > 0,
    });
    for (const child of root.children ?? []) {
      rows.push({
        id: child.id,
        name: child.name,
        parentId: child.parentId,
        sort: child.sort,
        productCount: child.productCount,
        isChild: true,
        hasChildren: false,
      });
    }
  }

  const rootOptions = rows.filter((row) => !row.isChild);

  function openCreate(parentId = '') {
    setModal({ open: true, editing: null, name: '', parentId, sort: '0' });
  }

  function openEdit(row: FlatRow) {
    setModal({
      open: true,
      editing: row,
      name: row.name,
      parentId: row.parentId ?? '',
      sort: String(row.sort),
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!modal.name.trim()) {
      toast('请填写分类名称', 'error');
      return;
    }
    if (!Number.isInteger(Number(modal.sort))) {
      toast('排序必须为整数', 'error');
      return;
    }
    setSaving(true);
    try {
      if (modal.editing) {
        await api(`/admin/categories/${modal.editing.id}`, {
          method: 'PATCH',
          body: {
            name: modal.name.trim(),
            parentId: modal.parentId || null,
            sort: Number(modal.sort),
          },
        });
      } else {
        await api('/admin/categories', {
          method: 'POST',
          body: {
            name: modal.name.trim(),
            ...(modal.parentId ? { parentId: modal.parentId } : {}),
            sort: Number(modal.sort),
          },
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

  async function remove(row: FlatRow) {
    if (!window.confirm(`确定删除分类「${row.name}」吗？`)) return;
    try {
      await api(`/admin/categories/${row.id}`, { method: 'DELETE' });
      toast('已删除');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  const columns: Column<FlatRow>[] = [
    {
      key: 'name',
      title: '分类名称',
      render: (row) => (
        <span style={{ paddingLeft: row.isChild ? 20 : 0 }}>
          {row.isChild ? '— ' : ''}
          {row.name}
        </span>
      ),
    },
    {
      key: 'productCount',
      title: '商品数',
      align: 'right',
      render: (row) => <span className="mono">{row.productCount}</span>,
    },
    {
      key: 'sort',
      title: '排序',
      align: 'right',
      render: (row) => <span className="mono">{row.sort}</span>,
    },
    {
      key: 'actions',
      title: '操作',
      align: 'right',
      render: (row) =>
        canWrite ? (
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
            {!row.isChild && (
              <Button size="sm" variant="ghost" onClick={() => openCreate(row.id)}>
                新建子分类
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
              编辑
            </Button>
            <Button size="sm" variant="danger" onClick={() => void remove(row)}>
              删除
            </Button>
          </div>
        ) : null,
    },
  ];

  const movingRootLocked = Boolean(modal.editing && !modal.editing.isChild && modal.editing.hasChildren);

  return (
    <>
      <PageHeader
        title="分类管理"
        desc="最多两级分类，删除前需先清空子分类与商品"
        actions={canWrite ? <Button onClick={() => openCreate()}>新建分类</Button> : undefined}
      />

      <Card>
        <DataTable columns={columns} rows={rows} loading={loading} empty="还没有分类" />
      </Card>

      <Modal
        open={modal.open}
        title={modal.editing ? '编辑分类' : '新建分类'}
        onClose={() => setModal(CLOSED_MODAL)}
        footer={
          <>
            <Button variant="plain" onClick={() => setModal(CLOSED_MODAL)}>
              取消
            </Button>
            <Button loading={saving} onClick={(e) => void handleSubmit(e as unknown as FormEvent)}>
              保存
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="分类名称">
            <input
              className="input"
              value={modal.name}
              placeholder="例如：山野干货"
              onChange={(e) => setModal((prev) => ({ ...prev, name: e.target.value }))}
            />
          </Field>
          <Field
            label="父分类"
            hint={movingRootLocked ? '该分类下已有子分类，不能挂到其它分类下' : '留空表示一级分类'}
          >
            <select
              className="select"
              value={modal.parentId}
              disabled={movingRootLocked}
              onChange={(e) => setModal((prev) => ({ ...prev, parentId: e.target.value }))}
            >
              <option value="">顶级分类</option>
              {rootOptions
                .filter((row) => row.id !== modal.editing?.id)
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="排序" hint="数值越小越靠前">
            <input
              className="input"
              type="number"
              value={modal.sort}
              onChange={(e) => setModal((prev) => ({ ...prev, sort: e.target.value }))}
            />
          </Field>
        </form>
      </Modal>
    </>
  );
}
