import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { api, ApiError, toCents, toYuan } from '../api/client';
import { assetPreviewUrl } from '../api/assets';
import { hasRole } from '../auth';
import { AssetPicker } from '../components/AssetPicker';
import { toast } from '../components/toast';
import { Button, Card, Field, PageHeader } from '../components/ui';

interface ShopDetail {
  shopName: string;
  intro: string | null;
  servicePhone: string | null;
  logoKey: string | null;
  serviceEmail: string | null;
  serviceWechat: string | null;
  serviceHours: string | null;
  companyAddress: string | null;
  companyName: string | null;
  creditCode: string | null;
  icpNumber: string | null;
  icpUrl: string | null;
  policeNumber: string | null;
  policeUrl: string | null;
  officialSiteUrl: string | null;
  freeThresholdCents: number;
  flatFreightCents: number;
  payTimeoutMinutes: number;
  afterSaleDays: number;
  autoConfirmDays: number;
  regions: { id: string; regionName: string; freightCents: number }[];
}

interface ShopForm {
  shopName: string;
  intro: string;
  servicePhone: string;
  logoKey: string;
  serviceEmail: string;
  serviceWechat: string;
  serviceHours: string;
  companyAddress: string;
  companyName: string;
  creditCode: string;
  icpNumber: string;
  icpUrl: string;
  policeNumber: string;
  policeUrl: string;
  officialSiteUrl: string;
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
  logoKey: '',
  serviceEmail: '',
  serviceWechat: '',
  serviceHours: '',
  companyAddress: '',
  companyName: '',
  creditCode: '',
  icpNumber: '',
  icpUrl: '',
  policeNumber: '',
  policeUrl: '',
  officialSiteUrl: '',
  freeThresholdYuan: '0',
  flatFreightYuan: '0',
  payTimeoutMinutes: '15',
  afterSaleDays: '7',
  autoConfirmDays: '10',
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

/** 空串提交为 null，便于后端统一清空 */
function nullIfBlank(value: string): string | null {
  return value.trim() ? value.trim() : null;
}

export default function ShopSettings() {
  const canWrite = hasRole('SUPER');
  const [form, setForm] = useState<ShopForm>(EMPTY_FORM);
  const [businessDomain, setBusinessDomain] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [result, integration] = await Promise.all([
        api<ShopDetail>('/admin/shop'),
        api<{ businessDomain: string | null }>('/admin/integration').catch(() => null),
      ]);
      setForm({
        shopName: result.shopName,
        intro: result.intro ?? '',
        servicePhone: result.servicePhone ?? '',
        logoKey: result.logoKey ?? '',
        serviceEmail: result.serviceEmail ?? '',
        serviceWechat: result.serviceWechat ?? '',
        serviceHours: result.serviceHours ?? '',
        companyAddress: result.companyAddress ?? '',
        companyName: result.companyName ?? '',
        creditCode: result.creditCode ?? '',
        icpNumber: result.icpNumber ?? '',
        icpUrl: result.icpUrl ?? '',
        policeNumber: result.policeNumber ?? '',
        policeUrl: result.policeUrl ?? '',
        officialSiteUrl: result.officialSiteUrl ?? '',
        freeThresholdYuan: toYuan(result.freeThresholdCents),
        flatFreightYuan: toYuan(result.flatFreightCents),
        payTimeoutMinutes: String(result.payTimeoutMinutes),
        afterSaleDays: String(result.afterSaleDays),
        autoConfirmDays: String(result.autoConfirmDays),
      });
      setBusinessDomain(integration?.businessDomain ?? '');
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
    if (!form.servicePhone.trim()) {
      toast('请填写客服电话', 'error');
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
          logoKey: form.logoKey,
          serviceEmail: nullIfBlank(form.serviceEmail),
          serviceWechat: nullIfBlank(form.serviceWechat),
          serviceHours: nullIfBlank(form.serviceHours),
          companyAddress: nullIfBlank(form.companyAddress),
          companyName: nullIfBlank(form.companyName),
          creditCode: nullIfBlank(form.creditCode),
          icpNumber: nullIfBlank(form.icpNumber),
          icpUrl: nullIfBlank(form.icpUrl),
          policeNumber: nullIfBlank(form.policeNumber),
          policeUrl: nullIfBlank(form.policeUrl),
          officialSiteUrl: nullIfBlank(form.officialSiteUrl),
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

  const logoInitial = form.shopName.trim().slice(0, 1) || '山';

  return (
    <>
      <PageHeader title="店铺信息" desc="品牌资料、联系方式、主体备案与交易参数，修改后立即生效" />

      <form onSubmit={handleSubmit}>
        <Card title="品牌资料">
          {!canWrite && (
            <p className="small muted" style={{ marginTop: 0 }}>
              当前角色仅可查看店铺设置。
            </p>
          )}
          <div className="shop-brand-layout">
            <div className="grid grid-2 grow">
              <Field label="店铺名称" required>
                <input
                  className="input"
                  value={form.shopName}
                  disabled={!canWrite}
                  onChange={(e) => setField('shopName', e.target.value)}
                />
              </Field>
              <Field label="品牌 Logo" hint="建议正方形，未上传时用店铺名首字兜底">
                <AssetPicker
                  value={form.logoKey}
                  disabled={!canWrite}
                  onChange={(key) => setField('logoKey', key)}
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
            <div className="shop-brand-preview">
              <div className="shop-brand-preview-logo">
                {form.logoKey ? (
                  <img src={assetPreviewUrl(form.logoKey)} alt="店铺 Logo" />
                ) : (
                  logoInitial
                )}
              </div>
              <strong>{form.shopName.trim() || '店铺名称'}</strong>
              <span className="tiny muted">{form.intro.trim() || '店铺简介'}</span>
              <span className="shop-brand-preview-btn">微信一键登录</span>
            </div>
          </div>
        </Card>

        <Card title="联系方式">
          <div className="grid grid-2">
            <Field label="客服电话" required hint="展示在「我的 → 联系客服」，点击拨号">
              <input
                className="input"
                value={form.servicePhone}
                disabled={!canWrite}
                onChange={(e) => setField('servicePhone', e.target.value)}
              />
            </Field>
            <Field label="客服邮箱">
              <input
                className="input"
                value={form.serviceEmail}
                disabled={!canWrite}
                onChange={(e) => setField('serviceEmail', e.target.value)}
              />
            </Field>
            <Field label="客服微信">
              <input
                className="input"
                value={form.serviceWechat}
                disabled={!canWrite}
                onChange={(e) => setField('serviceWechat', e.target.value)}
              />
            </Field>
            <Field label="服务时间" hint="例如 9:00-21:00">
              <input
                className="input"
                value={form.serviceHours}
                disabled={!canWrite}
                onChange={(e) => setField('serviceHours', e.target.value)}
              />
            </Field>
            <Field label="公司地址" wide>
              <input
                className="input"
                value={form.companyAddress}
                disabled={!canWrite}
                onChange={(e) => setField('companyAddress', e.target.value)}
              />
            </Field>
          </div>
        </Card>

        <Card title="主体与备案">
          <div className="grid grid-2">
            <Field label="公司名称" hint="营业主体全称，展示在「关于我们」">
              <input
                className="input"
                value={form.companyName}
                disabled={!canWrite}
                onChange={(e) => setField('companyName', e.target.value)}
              />
            </Field>
            <Field label="统一社会信用代码" hint="18 位大写字母或数字">
              <input
                className="input"
                value={form.creditCode}
                maxLength={18}
                disabled={!canWrite}
                onChange={(e) => setField('creditCode', e.target.value.toUpperCase())}
              />
            </Field>
            <Field label="ICP 备案号" hint="例如 滇ICP备2026000000号">
              <input
                className="input"
                value={form.icpNumber}
                disabled={!canWrite}
                onChange={(e) => setField('icpNumber', e.target.value)}
              />
            </Field>
            <Field label="ICP 备案链接" hint="留空默认 https://beian.miit.gov.cn/">
              <input
                className="input"
                value={form.icpUrl}
                disabled={!canWrite}
                onChange={(e) => setField('icpUrl', e.target.value)}
              />
            </Field>
            <Field label="公安备案号">
              <input
                className="input"
                value={form.policeNumber}
                disabled={!canWrite}
                onChange={(e) => setField('policeNumber', e.target.value)}
              />
            </Field>
            <Field label="公安备案链接">
              <input
                className="input"
                value={form.policeUrl}
                disabled={!canWrite}
                onChange={(e) => setField('policeUrl', e.target.value)}
              />
            </Field>
            <Field label="官方商城地址" wide hint="对外 H5 站点，用于客服与分享引导">
              <input
                className="input"
                value={form.officialSiteUrl}
                disabled={!canWrite}
                onChange={(e) => setField('officialSiteUrl', e.target.value)}
              />
            </Field>
            <Field
              label="业务域名"
              wide
              hint="小程序 request 合法域名，在「小程序与支付」中维护；此处只读"
            >
              <div className="row" style={{ gap: 8 }}>
                <input className="input" value={businessDomain || '未配置'} disabled readOnly />
                <Link className="btn btn-plain btn-sm" to="/settings/integration">
                  去修改
                </Link>
              </div>
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
