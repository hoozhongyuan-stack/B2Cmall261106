import { useEffect, useState } from 'react';

import { api, ApiError } from '../api/client';
import { hasRole } from '../auth';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  Field,
  PageHeader,
  Tag,
  type Column,
} from '../components/ui';

interface ExpressCompany {
  id: string;
  code: string;
  name: string;
  sort: number;
  enabled: boolean;
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function ExpressSettings() {
  const canWrite = hasRole('SUPER', 'OPS', 'WMS');
  const [items, setItems] = useState<ExpressCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', sort: '0' });

  async function load() {
    setLoading(true);
    try {
      const result = await api<{ items: ExpressCompany[] }>('/admin/express-companies');
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

  async function create() {
    if (!canWrite) return;
    setSaving(true);
    try {
      await api('/admin/express-companies', {
        method: 'POST',
        body: {
          code: form.code.trim(),
          name: form.name.trim(),
          sort: Number(form.sort) || 0,
        },
      });
      toast('已新增');
      setForm({ code: '', name: '', sort: '0' });
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(row: ExpressCompany) {
    try {
      await api(`/admin/express-companies/${row.id}`, {
        method: 'PATCH',
        body: { enabled: !row.enabled },
      });
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  const columns: Column<ExpressCompany>[] = [
    { key: 'code', title: '编码', render: (row) => <span className="mono small">{row.code}</span> },
    { key: 'name', title: '名称', render: (row) => <span>{row.name}</span> },
    { key: 'sort', title: '排序', render: (row) => <span className="mono small">{row.sort}</span> },
    {
      key: 'enabled',
      title: '状态',
      render: (row) => <Tag tone={row.enabled ? 'ok' : 'muted'}>{row.enabled ? '启用' : '停用'}</Tag>,
    },
    {
      key: 'action',
      title: '操作',
      align: 'right',
      render: (row) =>
        canWrite ? (
          <Button size="sm" variant="ghost" onClick={() => void toggle(row)}>
            {row.enabled ? '停用' : '启用'}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title="物流公司" desc="批量发货与物流单号展示使用的字典；停用后不可再选择" />

      {canWrite && (
        <Card title="新增物流公司">
          <div className="grid grid-3">
            <Field label="编码" hint="大写字母 / 数字，例如 SF">
              <input
                className="input"
                value={form.code}
                placeholder="SF"
                onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
              />
            </Field>
            <Field label="名称">
              <input
                className="input"
                value={form.name}
                placeholder="顺丰速运"
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </Field>
            <Field label="排序">
              <input
                className="input"
                type="number"
                value={form.sort}
                onChange={(e) => setForm((prev) => ({ ...prev, sort: e.target.value }))}
              />
            </Field>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button loading={saving} onClick={() => void create()}>
              新增
            </Button>
          </div>
        </Card>
      )}

      <Card title="物流公司列表">
        <DataTable columns={columns} rows={items} loading={loading} empty="暂无物流公司" />
      </Card>
    </>
  );
}
