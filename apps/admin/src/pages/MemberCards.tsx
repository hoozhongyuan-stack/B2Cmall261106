import { useEffect, useRef, useState } from 'react';

import { api, ApiError, money, toCents } from '../api/client';
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

interface CardPlan {
  id: string;
  name: string;
  priceCents: number;
  durationDays: number;
  discountRate: number;
  pointsRate: number;
  freeShipping: boolean;
  enabled: boolean;
  sort: number;
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

function discountText(rate: number): string {
  if (rate >= 1) return '无折扣';
  return `${(rate * 10).toFixed(1).replace(/\.0$/, '')} 折`;
}

export default function MemberCards() {
  const canWrite = can('membercard.manage');
  const [plans, setPlans] = useState<CardPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    price: '',
    days: '30',
    discount: '0.95',
    pointsRate: '1.5',
    freeShipping: false,
  });
  const [errors, setErrors] = useState<{
    name?: string;
    price?: string;
    days?: string;
    discount?: string;
    pointsRate?: string;
  }>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const result = await api<{ items: CardPlan[] }>('/admin/member-card-plans');
      setPlans(result.items);
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
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function create() {
    if (!canWrite) return;
    const priceCents = toCents(form.price);
    const durationDays = Number(form.days);
    const discountRate = Number(form.discount);
    const pointsRate = Number(form.pointsRate);
    const nextErrors: typeof errors = {};
    if (!form.name.trim()) nextErrors.name = '请填写方案名称';
    if (priceCents <= 0) nextErrors.price = '售价需大于 0';
    if (!Number.isInteger(durationDays) || durationDays <= 0) {
      nextErrors.days = '有效期需为正整数';
    }
    if (!Number.isFinite(discountRate) || discountRate <= 0 || discountRate > 1) {
      nextErrors.discount = '折扣率需在 0~1 之间，0.95 表示 9.5 折';
    }
    if (!Number.isFinite(pointsRate) || pointsRate <= 0) {
      nextErrors.pointsRate = '积分倍率需大于 0';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      if (nextErrors.name) nameRef.current?.focus();
      else if (nextErrors.price) priceRef.current?.focus();
      return;
    }

    setSaving(true);
    try {
      await api('/admin/member-card-plans', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          priceCents,
          durationDays,
          discountRate,
          pointsRate,
          freeShipping: form.freeShipping,
        },
      });
      toast('已新增会员卡方案');
      setForm({
        name: '',
        price: '',
        days: '30',
        discount: '0.95',
        pointsRate: '1.5',
        freeShipping: false,
      });
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(plan: CardPlan) {
    try {
      await api(`/admin/member-card-plans/${plan.id}`, {
        method: 'PATCH',
        body: { enabled: !plan.enabled },
      });
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  const columns: Column<CardPlan>[] = [
    {
      key: 'name',
      title: '方案',
      minWidth: 140,
      render: (row) => <span>{row.name}</span>,
    },
    {
      key: 'price',
      title: '售价',
      align: 'right',
      minWidth: 90,
      nowrap: true,
      render: (row) => <span className="money">{money(row.priceCents)}</span>,
    },
    {
      key: 'duration',
      title: '有效期',
      minWidth: 90,
      nowrap: true,
      render: (row) => <span className="small">{row.durationDays} 天</span>,
    },
    {
      key: 'discount',
      title: '折扣',
      minWidth: 90,
      nowrap: true,
      render: (row) => <span className="small">{discountText(row.discountRate)}</span>,
    },
    {
      key: 'points',
      title: '积分',
      minWidth: 80,
      nowrap: true,
      render: (row) => <span className="small">×{row.pointsRate}</span>,
    },
    {
      key: 'shipping',
      title: '包邮',
      minWidth: 70,
      render: (row) =>
        row.freeShipping ? <Tag tone="ok">是</Tag> : <span className="muted small">否</span>,
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
      width: '100px',
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
      <PageHeader
        title="会员卡"
        desc="付费会员卡方案与权益；会员折扣与等级折扣取最优"
      />

      <Card title="会员卡方案">
        {canWrite && (
          <div className="grid grid-3">
            <Field label="方案名称" required>
              <input
                ref={nameRef}
                className={`input${errors.name ? ' is-error' : ''}`}
                value={form.name}
                placeholder="山野季卡"
                aria-invalid={Boolean(errors.name)}
                onChange={(e) => setField('name', e.target.value)}
              />
              {errors.name && <span className="field-error">{errors.name}</span>}
            </Field>
            <Field label="售价（元）" required>
              <input
                ref={priceRef}
                className={`input${errors.price ? ' is-error' : ''}`}
                value={form.price}
                placeholder="49.9"
                aria-invalid={Boolean(errors.price)}
                onChange={(e) => setField('price', e.target.value)}
              />
              {errors.price && <span className="field-error">{errors.price}</span>}
            </Field>
            <Field label="有效期（天）" required>
              <input
                className={`input${errors.days ? ' is-error' : ''}`}
                type="number"
                value={form.days}
                aria-invalid={Boolean(errors.days)}
                onChange={(e) => setField('days', e.target.value)}
              />
              {errors.days && <span className="field-error">{errors.days}</span>}
            </Field>
            <Field label="折扣率" required hint="0.95 表示 9.5 折">
              <input
                className={`input${errors.discount ? ' is-error' : ''}`}
                type="number"
                step="0.01"
                value={form.discount}
                aria-invalid={Boolean(errors.discount)}
                onChange={(e) => setField('discount', e.target.value)}
              />
              {errors.discount && <span className="field-error">{errors.discount}</span>}
            </Field>
            <Field label="积分倍率" required hint="消费积分按倍率累加">
              <input
                className={`input${errors.pointsRate ? ' is-error' : ''}`}
                type="number"
                step="0.1"
                value={form.pointsRate}
                aria-invalid={Boolean(errors.pointsRate)}
                onChange={(e) => setField('pointsRate', e.target.value)}
              />
              {errors.pointsRate && <span className="field-error">{errors.pointsRate}</span>}
            </Field>
            <Field label="包邮权益">
              <label className="row small" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={form.freeShipping}
                  onChange={(e) => setField('freeShipping', e.target.checked)}
                />
                购买后全场包邮（偏远地区除外）
              </label>
            </Field>
          </div>
        )}
        {canWrite && (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button loading={saving} onClick={() => void create()}>
              新增方案
            </Button>
          </div>
        )}
        <DataTable columns={columns} rows={plans} loading={loading} empty="暂无会员卡方案" />
      </Card>
    </>
  );
}
