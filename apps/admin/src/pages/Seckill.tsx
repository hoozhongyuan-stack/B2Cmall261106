import { useEffect, useRef, useState } from 'react';

import { api, ApiError, formatDate, money, toCents } from '../api/client';
import { can } from '../auth';
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

interface PromotionRow {
  id: string;
  name: string;
  type: 'FULL_REDUCTION' | 'SECKILL';
  enabled: boolean;
  startAt: string;
  endAt: string;
  skus: Array<{ sold: number; stock: number }>;
}

interface ProductOption {
  id: string;
  title: string;
}

interface SkuRow {
  id: string;
  code: string;
  priceCents: number;
  specJson: Record<string, string>;
}

interface SeckillDraft {
  price: string;
  stock: string;
  limit: string;
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

function localDateTime(hoursFromNow: number): string {
  const date = new Date(Date.now() + hoursFromNow * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export default function Seckill() {
  const canWrite = can('promotion.manage');
  const [items, setItems] = useState<PromotionRow[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    startAt: localDateTime(0),
    endAt: localDateTime(72),
  });
  const [errors, setErrors] = useState<{ name?: string; time?: string; skus?: string }>({});
  const nameRef = useRef<HTMLInputElement>(null);

  const [productId, setProductId] = useState('');
  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SeckillDraft>>({});

  async function load() {
    setLoading(true);
    try {
      const [promotions, productResult] = await Promise.all([
        api<{ items: PromotionRow[] }>('/admin/promotions'),
        api<{ items: ProductOption[] }>('/admin/products', { query: { pageSize: 200 } }),
      ]);
      setItems(promotions.items.filter((item) => item.type === 'SECKILL'));
      setProducts(productResult.items);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function loadSkus(nextProductId: string) {
    setProductId(nextProductId);
    setDrafts({});
    setErrors((prev) => ({ ...prev, skus: undefined }));
    if (!nextProductId) {
      setSkus([]);
      return;
    }
    try {
      const detail = await api<{ skus: SkuRow[] }>(`/admin/products/${nextProductId}`);
      setSkus(detail.skus ?? []);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  function updateDraft(skuId: string, patch: Partial<SeckillDraft>) {
    setDrafts((prev) => {
      const current = prev[skuId] ?? { price: '', stock: '10', limit: '1' };
      return { ...prev, [skuId]: { ...current, ...patch } };
    });
    setErrors((prev) => ({ ...prev, skus: undefined }));
  }

  async function create() {
    if (!canWrite) return;
    const nextErrors: typeof errors = {};
    if (!form.name.trim()) nextErrors.name = '请填写活动名称';
    if (new Date(form.endAt).getTime() <= new Date(form.startAt).getTime()) {
      nextErrors.time = '结束时间需晚于开始时间';
    }
    const skuPayload = Object.entries(drafts)
      .filter(([, draft]) => draft.price || draft.stock)
      .map(([skuId, draft]) => ({
        skuId,
        seckillPriceCents: toCents(draft.price),
        stock: Number(draft.stock) || 0,
        limitPerUser: Number(draft.limit) || 1,
      }))
      .filter((row) => row.seckillPriceCents > 0 && row.stock > 0);
    if (skuPayload.length === 0) nextErrors.skus = '请至少为一个 SKU 填写秒杀价与库存';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      if (nextErrors.name) nameRef.current?.focus();
      return;
    }

    setSaving(true);
    try {
      await api('/admin/promotions', {
        method: 'POST',
        body: {
          type: 'SECKILL',
          name: form.name.trim(),
          startAt: new Date(form.startAt).toISOString(),
          endAt: new Date(form.endAt).toISOString(),
          skus: skuPayload,
        },
      });
      toast('秒杀活动已创建');
      setForm({
        name: '',
        startAt: localDateTime(0),
        endAt: localDateTime(72),
      });
      setProductId('');
      setSkus([]);
      setDrafts({});
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(row: PromotionRow) {
    try {
      await api(`/admin/promotions/${row.id}`, {
        method: 'PATCH',
        body: { enabled: !row.enabled },
      });
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function remove(row: PromotionRow) {
    try {
      await api(`/admin/promotions/${row.id}`, { method: 'DELETE' });
      toast('已删除');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  const columns: Column<PromotionRow>[] = [
    {
      key: 'name',
      title: '活动',
      minWidth: 160,
      render: (row) => <span>{row.name}</span>,
    },
    {
      key: 'stock',
      title: '秒杀商品',
      minWidth: 200,
      render: (row) => (
        <span className="small">
          {row.skus.length} 个商品
          <span className="muted">
            {' · 已售 '}
            {row.skus.reduce((sum, sku) => sum + sku.sold, 0)} /{' '}
            {row.skus.reduce((sum, sku) => sum + sku.stock, 0)}
          </span>
        </span>
      ),
    },
    {
      key: 'time',
      title: '活动时间',
      minWidth: 230,
      nowrap: true,
      render: (row) => (
        <span className="small mono">
          {formatDate(row.startAt)} ~ {formatDate(row.endAt)}
        </span>
      ),
    },
    {
      key: 'enabled',
      title: '状态',
      minWidth: 80,
      render: (row) => (
        <Tag tone={row.enabled ? 'ok' : 'muted'}>{row.enabled ? '启用' : '停用'}</Tag>
      ),
    },
    {
      key: 'action',
      title: '操作',
      align: 'right',
      width: '140px',
      render: (row) =>
        canWrite ? (
          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" onClick={() => void toggle(row)}>
              {row.enabled ? '停用' : '启用'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void remove(row)}>
              删除
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="秒杀活动"
        desc="秒杀价不参与会员折扣、优惠券与满减；每个 SKU 单独设置秒杀价、库存与限购"
      />

      {canWrite && (
        <Card title="新建秒杀活动">
          <div className="grid grid-2">
            <Field label="活动名称" required hint="例如：周末限时秒杀">
              <input
                ref={nameRef}
                className={`input${errors.name ? ' is-error' : ''}`}
                value={form.name}
                placeholder="周末限时秒杀"
                aria-invalid={Boolean(errors.name)}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, name: e.target.value }));
                  setErrors((prev) => ({ ...prev, name: undefined }));
                }}
              />
              {errors.name && <span className="field-error">{errors.name}</span>}
            </Field>
            <div />
            <Field label="开始时间" required>
              <input
                className="input"
                type="datetime-local"
                value={form.startAt}
                onChange={(e) => setForm((prev) => ({ ...prev, startAt: e.target.value }))}
              />
            </Field>
            <Field label="结束时间" required>
              <input
                className={`input${errors.time ? ' is-error' : ''}`}
                type="datetime-local"
                value={form.endAt}
                aria-invalid={Boolean(errors.time)}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, endAt: e.target.value }));
                  setErrors((prev) => ({ ...prev, time: undefined }));
                }}
              />
              {errors.time && <span className="field-error">{errors.time}</span>}
            </Field>
          </div>

          <Field label="选择商品" required>
            <select
              className="input"
              value={productId}
              onChange={(e) => void loadSkus(e.target.value)}
            >
              <option value="">请选择商品</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title}
                </option>
              ))}
            </select>
          </Field>

          {skus.length > 0 && (
            <div className="field">
              <span className="field-label">SKU 秒杀设置</span>
              <div style={{ display: 'grid', gap: 8 }}>
                <div className="row small muted" style={{ gap: 8 }}>
                  <span className="grow">规格 / 原价</span>
                  <span style={{ width: 110 }}>秒杀价</span>
                  <span style={{ width: 90 }}>库存</span>
                  <span style={{ width: 90 }}>限购</span>
                </div>
                {skus.map((sku) => {
                  const draft = drafts[sku.id];
                  return (
                    <div key={sku.id} className="row" style={{ gap: 8 }}>
                      <span className="small grow">
                        {Object.values(sku.specJson ?? {}).join(' / ') || sku.code}
                        <span className="muted">（原价 {money(sku.priceCents)}）</span>
                      </span>
                      <input
                        className="input"
                        style={{ width: 110 }}
                        placeholder="秒杀价"
                        aria-label="秒杀价"
                        value={draft?.price ?? ''}
                        onChange={(e) => updateDraft(sku.id, { price: e.target.value })}
                      />
                      <input
                        className="input"
                        style={{ width: 90 }}
                        placeholder="库存"
                        aria-label="秒杀库存"
                        value={draft?.stock ?? ''}
                        onChange={(e) => updateDraft(sku.id, { stock: e.target.value })}
                      />
                      <input
                        className="input"
                        style={{ width: 90 }}
                        placeholder="限购"
                        aria-label="每人限购"
                        value={draft?.limit ?? ''}
                        onChange={(e) => updateDraft(sku.id, { limit: e.target.value })}
                      />
                    </div>
                  );
                })}
              </div>
              {errors.skus && <span className="field-error">{errors.skus}</span>}
            </div>
          )}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button loading={saving} onClick={() => void create()}>
              创建活动
            </Button>
          </div>
        </Card>
      )}

      <Card title="秒杀活动列表">
        <DataTable
          columns={columns}
          rows={items}
          loading={loading}
          empty="暂无秒杀活动，先创建一个吧"
        />
      </Card>
    </>
  );
}
