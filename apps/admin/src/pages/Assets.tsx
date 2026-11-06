import { useEffect, useState, type FormEvent } from 'react';

import { api, ApiError, formatDate } from '../api/client';
import { hasRole } from '../auth';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  Empty,
  Field,
  Modal,
  PageHeader,
  Tag,
  Toolbar,
} from '../components/ui';

interface AssetRow {
  id: string;
  key: string;
  url: string;
  size: number;
  mimeType: string | null;
  group: string;
  refCount: number;
  createdAt: string;
}

const CLOSED_FORM = { key: '', url: '', group: 'default' };

function formatSize(size: number): string {
  if (!size || size <= 0) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function Assets() {
  const canWrite = hasRole('SUPER', 'OPS');
  const [items, setItems] = useState<AssetRow[]>([]);
  const [keyword, setKeyword] = useState('');
  const [group, setGroup] = useState('');
  const [applied, setApplied] = useState({ keyword: '', group: '' });
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(CLOSED_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const result = await api<{ items: AssetRow[] }>('/admin/assets', {
          query: { keyword: applied.keyword, group: applied.group },
        });
        if (alive) setItems(result.items);
      } catch (err) {
        if (alive) toast(errorText(err), 'error');
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [applied]);

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    setApplied({ keyword: keyword.trim(), group: group.trim() });
  }

  async function createAsset() {
    if (!canWrite) {
      toast('当前角色没有素材登记权限', 'error');
      return;
    }
    if (!form.key.trim() || !form.url.trim()) {
      toast('请填写素材 key 与地址', 'error');
      return;
    }
    setSaving(true);
    try {
      await api('/admin/assets', {
        method: 'POST',
        body: {
          key: form.key.trim(),
          url: form.url.trim(),
          group: form.group.trim() || 'default',
        },
      });
      toast('已保存');
      setModalOpen(false);
      setForm(CLOSED_FORM);
      setApplied({ keyword: keyword.trim(), group: group.trim() });
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function removeAsset(row: AssetRow) {
    if (!window.confirm(`确定删除素材「${row.key}」吗？已被引用的素材无法删除。`)) return;
    try {
      await api(`/admin/assets/${row.id}`, { method: 'DELETE' });
      toast('已删除');
      setApplied({ keyword: applied.keyword, group: applied.group });
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="素材库"
        desc="登记图片等素材，被商品或评价引用的素材不可删除"
        actions={
          canWrite ? <Button onClick={() => setModalOpen(true)}>登记素材</Button> : undefined
        }
      />

      <Card>
        <form onSubmit={handleSearch}>
          <Toolbar>
            <input
              className="input"
              style={{ width: 240 }}
              placeholder="搜索素材 key"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <input
              className="input"
              style={{ width: 160 }}
              placeholder="分组，例如 products"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            />
            <Button type="submit" variant="ghost">
              搜索
            </Button>
            <Button
              type="button"
              variant="plain"
              onClick={() => {
                setKeyword('');
                setGroup('');
                setApplied({ keyword: '', group: '' });
              }}
            >
              重置
            </Button>
          </Toolbar>
        </form>

        {loading ? (
          <div className="table-loading">加载中…</div>
        ) : items.length === 0 ? (
          <Empty text="还没有素材" />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 14,
            }}
          >
            {items.map((item) => (
              <div
                key={item.id}
                style={{
                  background: 'var(--surface-2)',
                  borderRadius: 'var(--radius-md)',
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <img
                  src={item.url}
                  alt={item.key}
                  style={{
                    width: '100%',
                    height: 130,
                    objectFit: 'cover',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface)',
                  }}
                />
                <div className="mono small" style={{ wordBreak: 'break-all' }}>
                  {item.key}
                </div>
                <div className="row-between">
                  <Tag tone="brand">{item.group}</Tag>
                  <Tag tone={item.refCount > 0 ? 'warn' : 'muted'}>
                    引用 {item.refCount}
                  </Tag>
                </div>
                <div className="small muted">
                  {item.mimeType ?? '未知类型'} · {formatSize(item.size)}
                </div>
                <div className="small muted">登记于 {formatDate(item.createdAt)}</div>
                {canWrite && (
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="danger" onClick={() => void removeAsset(item)}>
                      删除
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        title="登记素材"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="plain" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button loading={saving} onClick={() => void createAsset()}>
              保存
            </Button>
          </>
        }
      >
        <Field label="素材 Key" hint="全局唯一，例如 products/honey.jpg">
          <input
            className="input"
            value={form.key}
            onChange={(e) => setForm((prev) => ({ ...prev, key: e.target.value }))}
          />
        </Field>
        <Field label="素材地址">
          <input
            className="input"
            value={form.url}
            placeholder="https://… 或 CDN 路径"
            onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
          />
        </Field>
        <Field label="分组" hint="用于筛选，默认 default">
          <input
            className="input"
            value={form.group}
            onChange={(e) => setForm((prev) => ({ ...prev, group: e.target.value }))}
          />
        </Field>
      </Modal>
    </>
  );
}
