import { useEffect, useState, type FormEvent } from 'react';

import { api, ApiError, toCents, toYuan } from '../api/client';
import { hasRole } from '../auth';
import { toast } from '../components/toast';
import { Button, Card, Field, PageHeader } from '../components/ui';

interface ShopDetail {
  shopName: string;
  intro: string | null;
  servicePhone: string | null;
  logoKey: string | null;
  freeThresholdCents: number;
  flatFreightCents: number;
  payTimeoutMinutes: number;
  afterSaleDays: number;
  autoConfirmDays: number;
  miniappAppId: string | null;
  regions: { id: string; regionName: string; freightCents: number }[];
}

interface ShopForm {
  shopName: string;
  intro: string;
  servicePhone: string;
  miniappAppId: string;
  freeThresholdYuan: string;
  flatFreightYuan: string;
  payTimeoutMinutes: string;
  afterSaleDays: string;
  autoConfirmDays: string;
}

const EMPTY_FORM: ShopForm = {
  shopName: '',
  intro: '',
  servicePhone: '',
  miniappAppId: '',
  freeThresholdYuan: '0',
  flatFreightYuan: '0',
  payTimeoutMinutes: '15',
  afterSaleDays: '7',
  autoConfirmDays: '10',
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function ShopSettings() {
  const canWrite = hasRole('SUPER');
  const [form, setForm] = useState<ShopForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await api<ShopDetail>('/admin/shop');
      setForm({
        shopName: result.shopName,
        intro: result.intro ?? '',
        servicePhone: result.servicePhone ?? '',
        miniappAppId: result.miniappAppId ?? '',
        freeThresholdYuan: toYuan(result.freeThresholdCents),
        flatFreightYuan: toYuan(result.flatFreightCents),
        payTimeoutMinutes: String(result.payTimeoutMinutes),
        afterSaleDays: String(result.afterSaleDays),
        autoConfirmDays: String(result.autoConfirmDays),
      });
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function setField<K extends keyof ShopForm>(key: K, value: ShopForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      toast('只有超级管理员可以修改店铺设置', 'error');
      return;
    }
    if (!form.shopName.trim()) {
      toast('请填写店铺名称', 'error');
      return;
    }
    const intFields: { key: keyof ShopForm; label: string }[] = [
      { key: 'payTimeoutMinutes', label: '支付超时时间' },
      { key: 'afterSaleDays', label: '售后期天数' },
      { key: 'autoConfirmDays', label: '自动确认收货天数' },
    ];
    for (const field of intFields) {
      const value = Number(form[field.key]);
      if (!Number.isInteger(value) || value < 0) {
        toast(`${field.label}必须为非负整数`, 'error');
        return;
      }
    }

    setSaving(true);
    try {
      await api('/admin/shop', {
        method: 'PATCH',
        body: {
          shopName: form.shopName.trim(),
          intro: form.intro,
          servicePhone: form.servicePhone.trim(),
          miniappAppId: form.miniappAppId.trim(),
          freeThresholdCents: toCents(form.freeThresholdYuan),
          flatFreightCents: toCents(form.flatFreightYuan),
          payTimeoutMinutes: Number(form.payTimeoutMinutes),
          afterSaleDays: Number(form.afterSaleDays),
          autoConfirmDays: Number(form.autoConfirmDays),
        },
      });
      toast('已保存');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="店铺信息" />
        <div className="table-loading">加载中…</div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="店铺信息" desc="店铺基础资料与交易参数，修改后立即生效" />

      <form onSubmit={handleSubmit}>
        <Card title="基础资料">
          {!canWrite && (
            <p className="small muted" style={{ marginTop: 0 }}>
              当前角色仅可查看店铺设置。
            </p>
          )}
          <div className="grid grid-2">
            <Field label="店铺名称">
              <input
                className="input"
                value={form.shopName}
                disabled={!canWrite}
                onChange={(e) => setField('shopName', e.target.value)}
              />
            </Field>
            <Field label="客服电话">
              <input
                className="input"
                value={form.servicePhone}
                disabled={!canWrite}
                onChange={(e) => setField('servicePhone', e.target.value)}
              />
            </Field>
            <Field label="小程序 AppID">
              <input
                className="input"
                value={form.miniappAppId}
                disabled={!canWrite}
                onChange={(e) => setField('miniappAppId', e.target.value)}
              />
            </Field>
            <Field label="店铺简介" wide>
              <textarea
                className="textarea"
                value={form.intro}
                disabled={!canWrite}
                onChange={(e) => setField('intro', e.target.value)}
              />
            </Field>
          </div>
        </Card>

        <Card title="交易参数">
          <div className="grid grid-2">
            <Field label="满额包邮门槛（元）">
              <input
                className="input"
                type="number"
                step="0.01"
                value={form.freeThresholdYuan}
                disabled={!canWrite}
                onChange={(e) => setField('freeThresholdYuan', e.target.value)}
              />
            </Field>
            <Field label="固定运费（元）">
              <input
                className="input"
                type="number"
                step="0.01"
                value={form.flatFreightYuan}
                disabled={!canWrite}
                onChange={(e) => setField('flatFreightYuan', e.target.value)}
              />
            </Field>
            <Field label="支付超时（分钟）">
              <input
                className="input"
                type="number"
                value={form.payTimeoutMinutes}
                disabled={!canWrite}
                onChange={(e) => setField('payTimeoutMinutes', e.target.value)}
              />
            </Field>
            <Field label="售后期（天）">
              <input
                className="input"
                type="number"
                value={form.afterSaleDays}
                disabled={!canWrite}
                onChange={(e) => setField('afterSaleDays', e.target.value)}
              />
            </Field>
            <Field label="自动确认收货（天）">
              <input
                className="input"
                type="number"
                value={form.autoConfirmDays}
                disabled={!canWrite}
                onChange={(e) => setField('autoConfirmDays', e.target.value)}
              />
            </Field>
          </div>
        </Card>

        <div className="row-between">
          <span className="small muted">运费地区例外请在「运费模板」中维护</span>
          <Button type="submit" loading={saving} disabled={!canWrite}>
            保存设置
          </Button>
        </div>
      </form>
    </>
  );
}
