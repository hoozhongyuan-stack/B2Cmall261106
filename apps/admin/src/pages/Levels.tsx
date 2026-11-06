import { useEffect, useState, type FormEvent } from 'react';

import { api, ApiError, money, toCents, toYuan } from '../api/client';
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

interface LevelRow {
  id: string;
  name: string;
  thresholdCents: number;
  discountRate: number;
  sort: number;
  _count: { users: number };
}

interface ModalState {
  open: boolean;
  editing: LevelRow | null;
  name: string;
  thresholdYuan: string;
  discountRate: string;
}

const CLOSED_MODAL: ModalState = {
  open: false,
  editing: null,
  name: '',
  thresholdYuan: '0',
  discountRate: '1',
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function Levels() {
  const canWrite = hasRole('SUPER', 'OPS');
  const [items, setItems] = useState<LevelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>(CLOSED_MODAL);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await api<LevelRow[]>('/admin/member-levels');
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
    const discount = Number(modal.discountRate);
    if (!modal.name.trim()) {
      toast('请填写等级名称', 'error');
      return;
    }
    if (!(discount > 0) || discount > 1) {
      toast('折扣率需在 0 与 1 之间，1 表示不打折', 'error');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: modal.name.trim(),
        thresholdCents: toCents(modal.thresholdYuan),
        discountRate: discount,
      };
      if (modal.editing) {
        await api(`/admin/member-levels/${modal.editing.id}`, { method: 'PATCH', body });
      } else {
        await api('/admin/member-levels', { method: 'POST', body });
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

  const columns: Column<LevelRow>[] = [
    { key: 'name', title: '等级名称', render: (row) => <strong>{row.name}</strong> },
    {
      key: 'thresholdCents',
      title: '升级门槛',
      align: 'right',
      render: (row) => <span className="money">{money(row.thresholdCents)}</span>,
    },
    {
      key: 'discountRate',
      title: '会员折扣',
      align: 'right',
      render: (row) => <span className="mono">{(row.discountRate * 10).toFixed(1)} 折</span>,
    },
    {
      key: 'users',
      title: '当前人数',
      align: 'right',
      render: (row) => <span className="mono">{row._count.users}</span>,
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
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setModal({
                open: true,
                editing: row,
                name: row.name,
                thresholdYuan: toYuan(row.thresholdCents),
                discountRate: String(row.discountRate),
              })
            }
          >
            编辑
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="等级规则"
        desc="按累计消费自动匹配等级，门槛与折扣修改后对后续计算生效"
        actions={
          canWrite
            ? <Button onClick={() => setModal({ ...CLOSED_MODAL, open: true })}>新建等级</Button>
            : undefined
        }
      />

      <Card>
        <DataTable columns={columns} rows={items} loading={loading} empty="还没有等级规则" />
      </Card>

      <Modal
        open={modal.open}
        title={modal.editing ? '编辑等级' : '新建等级'}
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
          <Field label="等级名称">
            <input
              className="input"
              value={modal.name}
              placeholder="例如：山野金卡"
              onChange={(e) => setModal((prev) => ({ ...prev, name: e.target.value }))}
            />
          </Field>
          <Field label="升级门槛（元）" hint="累计消费达到该金额后升级">
            <input
              className="input"
              type="number"
              step="0.01"
              value={modal.thresholdYuan}
              onChange={(e) => setModal((prev) => ({ ...prev, thresholdYuan: e.target.value }))}
            />
          </Field>
          <Field label="折扣率" hint="0.01～1，例如 0.95 表示 9.5 折，1 表示不打折">
            <input
              className="input"
              type="number"
              step="0.01"
              min="0.01"
              max="1"
              value={modal.discountRate}
              onChange={(e) => setModal((prev) => ({ ...prev, discountRate: e.target.value }))}
            />
          </Field>
        </form>
      </Modal>
    </>
  );
}
