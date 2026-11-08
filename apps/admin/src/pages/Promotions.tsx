import { useEffect, useState } from 'react';

import { api, ApiError, formatDate, money, toCents } from '../api/client';
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

type PromotionType = 'FULL_REDUCTION' | 'SECKILL';

interface PromotionRow {
  id: string;
  name: string;
  type: PromotionType;
  enabled: boolean;
  startAt: string;
  endAt: string;
  thresholdCents: number | null;
  discountCents: number | null;
  scopeType: 'ALL' | 'CATEGORY' | 'PRODUCT';
  skus: Array<{ sold: number; stock: number }>;
}

interface ProductOption {
  id: string;
  title: string;
}

interface CategoryOption {
  id: string;
  name: string;
}

interface SkuRow {
  id: string;
  code: string;
  priceCents: number;
  specJson: Record<string, string>;
}

interface SeckillDraft {
  skuId: string;
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

export default function Promotions() {
  const canWrite = hasRole('SUPER', 'OPS');
  const [items, setItems] = useState<PromotionRow[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [type, setType] = useState<PromotionType>('FULL_REDUCTION');
  const [form, setForm] = useState({
    name: '',
    startAt: localDateTime(0),
    endAt: localDateTime(72),
    threshold: '',
    discount: '',
    scopeType: 'ALL' as 'ALL' | 'CATEGORY' | 'PRODUCT',
    scopeIds: [] as string[],
  });
  const [seckillProductId, setSeckillProductId] = useState('');
  const [seckillSkus, setSeckillSkus] = useState<SkuRow[]>([]);
  const [seckillDrafts, setSeckillDrafts] = useState<Record<string, SeckillDraft>>({});

  async function load() {
    setLoading(true);
    try {
      const [promotions, productResult, categoryResult] = await Promise.all([
        api<{ items: PromotionRow[] }>('/admin/promotions'),
        api<{ items: ProductOption[] }>('/admin/products'),
        api<CategoryOption[]>('/categories'),
      ]);
      setItems(promotions.items);
      setProducts(productResult.items);
      setCategories(categoryResult.map((item) => ({ id: item.id, name: item.name })));
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function loadSkus(productId: string) {
    setSeckillProductId(productId);
    setSeckillDrafts({});
    if (!productId) {
      setSeckillSkus([]);
      return;
    }
    try {
      const detail = await api<{ skus: SkuRow[] }>(`/admin/products/${productId}`);
      setSeckillSkus(detail.skus ?? []);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function create() {
    if (!canWrite) return;
    setSaving(true);
    try {
      const base = {
        type,
        name: form.name.trim(),
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
      };
      if (type === 'FULL_REDUCTION') {
        await api('/admin/promotions', {
          method: 'POST',
          body: {
            ...base,
            thresholdCents: toCents(form.threshold),
            discountCents: toCents(form.discount),
            scopeType: form.scopeType,
            ...(form.scopeType !== 'ALL'
              ? {
                  scopes: form.scopeIds.map((targetId) => ({
                    targetType: form.scopeType === 'PRODUCT' ? 'PRODUCT' : 'CATEGORY',
                    targetId,
                  })),
                }
              : {}),
          },
        });
      } else {
        const skus = Object.entries(seckillDrafts)
          .filter(([, draft]) => draft.price && draft.stock)
          .map(([skuId, draft]) => ({
            skuId,
            seckillPriceCents: toCents(draft.price),
            stock: Number(draft.stock) || 0,
            limitPerUser: Number(draft.limit) || 1,
          }));
        await api('/admin/promotions', {
          method: 'POST',
          body: { ...base, skus },
        });
      }
      toast('活动已创建');
      setForm((prev) => ({ ...prev, name: '', threshold: '', discount: '', scopeIds: [] }));
      setSeckillDrafts({});
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
    { key: 'name', title: '活动', render: (row) => <span>{row.name}</span> },
    {
      key: 'type',
      title: '类型',
      render: (row) => <Tag tone={row.type === 'SECKILL' ? 'warn' : 'brand'}>{row.type === 'SECKILL' ? '秒杀' : '满减'}</Tag>,
    },
    {
      key: 'rule',
      title: '规则',
      render: (row) =>
        row.type === 'FULL_REDUCTION' ? (
          <span className="small">
            满 {money(row.thresholdCents ?? 0)} 减 {money(row.discountCents ?? 0)}（
            {row.scopeType === 'ALL' ? '全场' : row.scopeType === 'PRODUCT' ? '指定商品' : '指定分类'}）
          </span>
        ) : (
          <span className="small">
            {row.skus.length} 个秒杀商品 · 已售{' '}
            {row.skus.reduce((sum, sku) => sum + sku.sold, 0)} /{' '}
            {row.skus.reduce((sum, sku) => sum + sku.stock, 0)}
          </span>
        ),
    },
    {
      key: 'time',
      title: '活动时间',
      render: (row) => (
        <span className="small mono">
          {formatDate(row.startAt)} ~ {formatDate(row.endAt)}
        </span>
      ),
    },
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
          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" onClick={() => void toggle(row)}>
              {row.enabled ? '停用' : '启用'}
            </Button>
            {hasRole('SUPER') && (
              <Button size="sm" variant="ghost" onClick={() => void remove(row)}>
                删除
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  const scopeOptions = form.scopeType === 'PRODUCT' ? products : categories;

  return (
    <>
      <PageHeader
        title="满减与秒杀"
        desc="满减在优惠券之后按券后金额判断门槛；秒杀价不参与会员折扣、优惠券与满减"
      />

      {canWrite && (
        <Card title="新建活动">
          <div className="grid grid-3">
            <Field label="活动类型">
              <select
                className="input"
                value={type}
                onChange={(e) => setType(e.target.value as PromotionType)}
              >
                <option value="FULL_REDUCTION">满减活动</option>
                <option value="SECKILL">限时秒杀</option>
              </select>
            </Field>
            <Field label="活动名称">
              <input
                className="input"
                value={form.name}
                placeholder={type === 'SECKILL' ? '周末秒杀' : '满 199 减 20'}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </Field>
            <div />
            <Field label="开始时间">
              <input
                className="input"
                type="datetime-local"
                value={form.startAt}
                onChange={(e) => setForm((prev) => ({ ...prev, startAt: e.target.value }))}
              />
            </Field>
            <Field label="结束时间">
              <input
                className="input"
                type="datetime-local"
                value={form.endAt}
                onChange={(e) => setForm((prev) => ({ ...prev, endAt: e.target.value }))}
              />
            </Field>
          </div>

          {type === 'FULL_REDUCTION' ? (
            <>
              <div className="grid grid-3">
                <Field label="门槛（元）">
                  <input
                    className="input"
                    value={form.threshold}
                    placeholder="199"
                    onChange={(e) => setForm((prev) => ({ ...prev, threshold: e.target.value }))}
                  />
                </Field>
                <Field label="减免（元）">
                  <input
                    className="input"
                    value={form.discount}
                    placeholder="20"
                    onChange={(e) => setForm((prev) => ({ ...prev, discount: e.target.value }))}
                  />
                </Field>
                <Field label="适用范围">
                  <select
                    className="input"
                    value={form.scopeType}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        scopeType: e.target.value as 'ALL' | 'CATEGORY' | 'PRODUCT',
                        scopeIds: [],
                      }))
                    }
                  >
                    <option value="ALL">全场</option>
                    <option value="CATEGORY">指定分类</option>
                    <option value="PRODUCT">指定商品</option>
                  </select>
                </Field>
              </div>
              {form.scopeType !== 'ALL' && (
                <Field label={`选择${form.scopeType === 'PRODUCT' ? '商品' : '分类'}（可多选）`}>
                  <select
                    className="input"
                    multiple
                    size={6}
                    value={form.scopeIds}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        scopeIds: [...e.target.selectedOptions].map((option) => option.value),
                      }))
                    }
                  >
                    {scopeOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {'title' in item ? item.title : item.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          ) : (
            <>
              <Field label="选择商品">
                <select
                  className="input"
                  value={seckillProductId}
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
              {seckillSkus.length > 0 && (
                <div style={{ display: 'grid', gap: 8 }}>
                  {seckillSkus.map((sku) => {
                    const draft = seckillDrafts[sku.id];
                    return (
                      <div key={sku.id} className="row" style={{ gap: 8 }}>
                        <span className="small grow">
                          {Object.values(sku.specJson ?? {}).join(' / ') || sku.code}
                          <span className="muted">（原价 {money(sku.priceCents)}）</span>
                        </span>
                        <input
                          className="input"
                          style={{ width: 100 }}
                          placeholder="秒杀价"
                          value={draft?.price ?? ''}
                          onChange={(e) =>
                            setSeckillDrafts((prev) => ({
                              ...prev,
                              [sku.id]: {
                                skuId: sku.id,
                                price: e.target.value,
                                stock: prev[sku.id]?.stock ?? '10',
                                limit: prev[sku.id]?.limit ?? '1',
                              },
                            }))
                          }
                        />
                        <input
                          className="input"
                          style={{ width: 90 }}
                          placeholder="库存"
                          value={draft?.stock ?? ''}
                          onChange={(e) =>
                            setSeckillDrafts((prev) => ({
                              ...prev,
                              [sku.id]: {
                                skuId: sku.id,
                                price: prev[sku.id]?.price ?? '',
                                stock: e.target.value,
                                limit: prev[sku.id]?.limit ?? '1',
                              },
                            }))
                          }
                        />
                        <input
                          className="input"
                          style={{ width: 90 }}
                          placeholder="限购"
                          value={draft?.limit ?? ''}
                          onChange={(e) =>
                            setSeckillDrafts((prev) => ({
                              ...prev,
                              [sku.id]: {
                                skuId: sku.id,
                                price: prev[sku.id]?.price ?? '',
                                stock: prev[sku.id]?.stock ?? '',
                                limit: e.target.value,
                              },
                            }))
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button loading={saving} onClick={() => void create()}>
              创建活动
            </Button>
          </div>
        </Card>
      )}

      <Card title="活动列表">
        <DataTable columns={columns} rows={items} loading={loading} empty="暂无活动" />
      </Card>
    </>
  );
}
