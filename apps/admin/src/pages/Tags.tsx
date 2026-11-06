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
  Tag,
  type Column,
} from '../components/ui';

interface TagRow {
  id: string;
  name: string;
  productId: string | null;
  productTitle: string | null;
}

interface ModalState {
  open: boolean;
  editing: TagRow | null;
  name: string;
}

const CLOSED_MODAL: ModalState = { open: false, editing: null, name: '' };

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function Tags() {
  const canWrite = hasRole('SUPER', 'OPS');
  const [items, setItems] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>(CLOSED_MODAL);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await api<TagRow[]>('/admin/tags');
      setItems(result);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!modal.name.trim()) {
      toast('请填写标签名称', 'error');
      return;
    }
    setSaving(true);
    try {
      if (modal.editing) {
        await api(`/admin/tags/${modal.editing.id}`, {
          method: 'PATCH',
          body: { name: modal.name.trim() },
        });
      } else {
        await api('/admin/tags', { method: 'POST', body: { name: modal.name.trim() } });
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
    if (!window.confirm(`确定删除标签「${row.name}」吗？`)) return;
    try {
      await api(`/admin/tags/${row.id}`, { method: 'DELETE' });
      toast('已删除');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  const columns: Column<TagRow>[] = [
    {
      key: 'name',
      title: '标签名称',
      render: (row) => (
        <div className="row">
          <Tag tone="brand">{row.name}</Tag>
        </div>
      ),
    },
    {
      key: 'productTitle',
      title: '关联商品',
      render: (row) => <span>{row.productTitle ?? '未指派'}</span>,
    },
    {
      key: 'actions',
      title: '操作',
      align: 'right',
      render: (row) =>
        canWrite ? (
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setModal({ open: true, editing: row, name: row.name })}
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
        title="标签管理"
        desc="标签用于商品促销与内容聚合，同一标签只能指派给一个商品"
        actions={
          canWrite ? (
            <Button onClick={() => setModal({ open: true, editing: null, name: '' })}>新建标签</Button>
          ) : undefined
        }
      />

      <Card>
        <DataTable columns={columns} rows={items} loading={loading} empty="还没有标签" />
      </Card>

      <Modal
        open={modal.open}
        title={modal.editing ? '重命名标签' : '新建标签'}
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
        <form onSubmit={handleSubmit}>
          <Field label="标签名称">
            <input
              className="input"
              value={modal.name}
              placeholder="例如：当季新品"
              onChange={(e) => setModal((prev) => ({ ...prev, name: e.target.value }))}
            />
          </Field>
        </form>
      </Modal>
    </>
  );
}
