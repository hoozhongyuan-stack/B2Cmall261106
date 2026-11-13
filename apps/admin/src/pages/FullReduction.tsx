import { useEffect, useRef, useState } from 'react';

import { api, ApiError, formatDate, money, toCents } from '../api/client';
import { can } from '../auth';
import { ScopePicker, type ScopeOption } from '../components/ScopePicker';
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
  thresholdCents: number | null;
  discountCents: number | null;
  scopeType: 'ALL' | 'CATEGORY' | 'PRODUCT';
  scopes: Array<{ targetType: string; targetId: string }>;
}

interface CategoryNode {
  id: string;
  name: string;
  children?: Array<{ id: string; name: string }>;
}

interface ProductOption {
  id: string;
  title: string;
}

type ScopeType = 'ALL' | 'CATEGORY' | 'PRODUCT';

const SCOPE_LABEL: Record<ScopeType, string> = {
  ALL: '全场',
  CATEGORY: '指定分类',
  PRODUCT: '指定商品',
};

const SCOPE_TABS: Array<{ value: ScopeType; label: string }> = [
  { value: 'ALL', label: '全场' },
  { value: 'CATEGORY', label: '指定分类' },
  { value: 'PRODUCT', label: '指定商品' },
];

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

export default function FullReduction() {
  const canWrite = can('promotion.manage');
  const [items, setItems] = useState<PromotionRow[]>([]);
  const [categories, setCategories] = useState<ScopeOption[]>([]);
  const [products, setProducts] = useState<ScopeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    startAt: localDateTime(0),
    endAt: localDateTime(72),
    threshold: '',
    discount: '',
    scopeType: 'ALL' as ScopeType,
    scopeIds: [] as string[],
  });
  const [errors, setErrors] = useState<{
    name?: string;
    time?: string;
    threshold?: string;
    discount?: string;
    scope?: string;
  }>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const thresholdRef = useRef<HTMLInputElement>(null);
  const discountRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const [promotions, categoryTree, productResult] = await Promise.all([
        api<{ items: PromotionRow[] }>('/admin/promotions'),
        api<CategoryNode[]>('/categories'),
        api<{ items: ProductOption[] }>('/admin/products', { query: { pageSize: 200 } }),
      ]);
      setItems(promotions.items.filter((item) => item.type === 'FULL_REDUCTION'));
      const flat: ScopeOption[] = [];
      for (const root of categoryTree) {
        flat.push({ id: root.id, name: root.name });
        for (const child of root.children ?? []) {
          flat.push({ id: child.id, name: child.name, group: root.name });
        }
      }
      setCategories(flat);
      setProducts(productResult.items.map((item) => ({ id: item.id, name: item.title })));
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === 'name') setErrors((prev) => ({ ...prev, name: undefined }));
    if (key === 'threshold') setErrors((prev) => ({ ...prev, threshold: undefined, discount: undefined }));
    if (key === 'discount') setErrors((prev) => ({ ...prev, discount: undefined }));
  }

  async function create() {
    if (!canWrite) return;
    const thresholdCents = toCents(form.threshold);
    const discountCents = toCents(form.discount);
    const nextErrors: typeof errors = {};
    if (!form.name.trim()) nextErrors.name = '请填写活动名称';
    if (new Date(form.endAt).getTime() <= new Date(form.startAt).getTime()) {
      nextErrors.time = '结束时间需晚于开始时间';
    }
    if (thresholdCents <= 0) nextErrors.threshold = '门槛需大于 0';
    if (discountCents <= 0) nextErrors.discount = '减免需大于 0';
    else if (discountCents >= thresholdCents && thresholdCents > 0) {
      nextErrors.discount = '减免需小于门槛';
    }
    if (form.scopeType !== 'ALL' && form.scopeIds.length === 0) {
      nextErrors.scope = `请至少选择 1 个${form.scopeType === 'PRODUCT' ? '商品' : '分类'}`;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      if (nextErrors.name) nameRef.current?.focus();
      else if (nextErrors.threshold) thresholdRef.current?.focus();
      else if (nextErrors.discount) discountRef.current?.focus();
      return;
    }

    setSaving(true);
    try {
      await api('/admin/promotions', {
        method: 'POST',
        body: {
          type: 'FULL_REDUCTION',
          name: form.name.trim(),
          startAt: new Date(form.startAt).toISOString(),
          endAt: new Date(form.endAt).toISOString(),
          thresholdCents,
          discountCents,
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
      toast('满减活动已创建');
      setForm((prev) => ({
        ...prev,
        name: '',
        threshold: '',
        discount: '',
        scopeIds: [],
        startAt: localDateTime(0),
        endAt: localDateTime(72),
      }));
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

  const scopeOptions = form.scopeType === 'PRODUCT' ? products : categories;
  const scopeSummary =
    form.scopeType === 'ALL'
      ? '全场'
      : `${SCOPE_LABEL[form.scopeType]} ${form.scopeIds.length} 个`;
  const preview =
    toCents(form.threshold) > 0 && toCents(form.discount) > 0
      ? `满 ${money(toCents(form.threshold))} 减 ${money(toCents(form.discount))} · ${scopeSummary}`
      : '填写门槛与减免后展示规则预览';

  const columns: Column<PromotionRow>[] = [
    {
      key: 'name',
      title: '活动',
      minWidth: 160,
      render: (row) => <span>{row.name}</span>,
    },
    {
      key: 'rule',
      title: '规则',
      minWidth: 240,
      render: (row) => (
        <span className="small">
          满 {money(row.thresholdCents ?? 0)} 减 {money(row.discountCents ?? 0)}
          <span className="muted">
            {' · '}
            {row.scopeType === 'ALL'
              ? '全场'
              : `${SCOPE_LABEL[row.scopeType]} ${row.scopes.length} 个`}
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
        title="满减活动"
        desc="在优惠券之后按券后金额判断门槛；满减与优惠券可叠加，秒杀商品不参与满减"
      />

      {canWrite && (
        <Card title="新建满减活动">
          <div className="grid grid-2">
            <Field label="活动名称" required hint="例如：满 199 减 20">
              <input
                ref={nameRef}
                className={`input${errors.name ? ' is-error' : ''}`}
                value={form.name}
                placeholder="满 199 减 20"
                aria-invalid={Boolean(errors.name)}
                onChange={(e) => setField('name', e.target.value)}
              />
              {errors.name && <span className="field-error">{errors.name}</span>}
            </Field>
            <div className="field">
              <span className="field-label">适用范围</span>
              <div className="seg">
                {SCOPE_TABS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={`seg-item${form.scopeType === item.value ? ' on' : ''}`}
                    onClick={() => {
                      setForm((prev) => ({ ...prev, scopeType: item.value, scopeIds: [] }));
                      setErrors((prev) => ({ ...prev, scope: undefined }));
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {errors.scope && <span className="field-error">{errors.scope}</span>}
            </div>
          </div>

          <div className="grid grid-2">
            <Field label="开始时间" required>
              <input
                className="input"
                type="datetime-local"
                value={form.startAt}
                onChange={(e) => setField('startAt', e.target.value)}
              />
            </Field>
            <Field label="结束时间" required>
              <input
                className={`input${errors.time ? ' is-error' : ''}`}
                type="datetime-local"
                value={form.endAt}
                aria-invalid={Boolean(errors.time)}
                onChange={(e) => {
                  setField('endAt', e.target.value);
                  setErrors((prev) => ({ ...prev, time: undefined }));
                }}
              />
              {errors.time && <span className="field-error">{errors.time}</span>}
            </Field>
          </div>

          <div className="grid grid-2">
            <Field label="门槛（元）" required hint="券后金额达到门槛才可减">
              <input
                ref={thresholdRef}
                className={`input${errors.threshold ? ' is-error' : ''}`}
                value={form.threshold}
                placeholder="199"
                aria-invalid={Boolean(errors.threshold)}
                onChange={(e) => setField('threshold', e.target.value)}
              />
              {errors.threshold && <span className="field-error">{errors.threshold}</span>}
            </Field>
            <Field label="减免（元）" required hint="减免需小于门槛">
              <input
                ref={discountRef}
                className={`input${errors.discount ? ' is-error' : ''}`}
                value={form.discount}
                placeholder="20"
                aria-invalid={Boolean(errors.discount)}
                onChange={(e) => setField('discount', e.target.value)}
              />
              {errors.discount && <span className="field-error">{errors.discount}</span>}
            </Field>
          </div>

          {form.scopeType !== 'ALL' && (
            <div className="field">
              <span className="field-label">
                {form.scopeType === 'PRODUCT' ? '选择商品' : '选择分类'}
              </span>
              <ScopePicker
                options={scopeOptions}
                selected={form.scopeIds}
                onChange={(ids) => {
                  setForm((prev) => ({ ...prev, scopeIds: ids }));
                  setErrors((prev) => ({ ...prev, scope: undefined }));
                }}
                placeholder={
                  form.scopeType === 'PRODUCT' ? '搜索商品名称…' : '搜索分类名称…'
                }
                emptyText={
                  form.scopeType === 'PRODUCT' ? '没有匹配的商品' : '没有匹配的分类'
                }
              />
            </div>
          )}

          <div className="row-between">
            <span className="small muted">{preview}</span>
            <Button loading={saving} onClick={() => void create()}>
              创建活动
            </Button>
          </div>
        </Card>
      )}

      <Card title="满减活动列表">
        <DataTable
          columns={columns}
          rows={items}
          loading={loading}
          empty="暂无满减活动，先创建一个吧"
        />
      </Card>
    </>
  );
}
