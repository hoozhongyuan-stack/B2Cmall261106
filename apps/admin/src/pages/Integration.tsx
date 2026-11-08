import { useEffect, useState, type FormEvent } from 'react';

import { api, ApiError, formatDate } from '../api/client';
import { hasRole } from '../auth';
import { toast } from '../components/toast';
import { Button, Card, Field, PageHeader, Tag } from '../components/ui';

interface SecretMeta {
  configured: boolean;
  fileName: string | null;
}

interface IntegrationDetail {
  miniappAppId: string | null;
  miniappAppSecret: { configured: boolean };
  miniappUploadKey: SecretMeta;
  paymentProvider: 'mock' | 'wechat';
  wechatPayMchId: string | null;
  wechatPayCertSerial: string | null;
  wechatPayNotifyUrl: string | null;
  wechatPayPublicKeyId: string | null;
  wechatPayApiV3Key: SecretMeta;
  wechatPayPrivateKey: SecretMeta;
  wechatPayPublicKey: SecretMeta;
  subscribeTemplateIds: {
    orderPaid: string;
    orderShipped: string;
    refundResult: string;
    pickupReady: string;
    pickupExpiring: string;
    deliveryAccepted: string;
    deliveryDone: string;
  };
  subscribeTemplateFields: Record<string, Record<string, string>>;
  apiBaseUrl: string | null;
  businessDomain: string | null;
  updatedAt: string;
}

type SecretField =
  | 'miniappUploadKey'
  | 'wechatPayApiV3Key'
  | 'wechatPayPrivateKey'
  | 'wechatPayPublicKey';

const SECRET_ACCEPT: Record<SecretField, string> = {
  miniappUploadKey: '.key,.pem',
  wechatPayApiV3Key: '.txt,.key,.secret',
  wechatPayPrivateKey: '.pem,.key,.p12,.pfx',
  wechatPayPublicKey: '.pem,.txt,.key',
};

const SECRET_MAX_BYTES = 200 * 1024;

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function SecretRow({
  field,
  label,
  hint,
  meta,
  disabled,
  uploading,
  onUpload,
  onRemove,
}: {
  field: SecretField;
  label: string;
  hint: string;
  meta: SecretMeta;
  disabled: boolean;
  uploading: boolean;
  onUpload: (file: File | undefined) => void;
  onRemove: () => void;
}) {
  return (
    <div className="field">
      <span className="field-label">
        {label} {meta.configured ? <Tag tone="ok">已配置</Tag> : <Tag tone="warn">未配置</Tag>}
      </span>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <input
          type="file"
          accept={SECRET_ACCEPT[field]}
          disabled={disabled || uploading}
          onChange={(e) => {
            onUpload(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {meta.configured && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onRemove}>
            删除
          </Button>
        )}
      </div>
      <span className="field-hint">{meta.configured ? `当前文件：${meta.fileName}` : hint}</span>
    </div>
  );
}

export default function IntegrationSettings() {
  const canWrite = hasRole('SUPER');
  const [detail, setDetail] = useState<IntegrationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<SecretField | null>(null);

  const [form, setForm] = useState({
    miniappAppId: '',
    miniappAppSecret: '',
    paymentProvider: 'mock' as 'mock' | 'wechat',
    wechatPayMchId: '',
    wechatPayCertSerial: '',
    wechatPayNotifyUrl: '',
    wechatPayPublicKeyId: '',
    orderPaid: '',
    orderShipped: '',
    refundResult: '',
    pickupReady: '',
    pickupExpiring: '',
    deliveryAccepted: '',
    deliveryDone: '',
    templateFields: '{}',
    apiBaseUrl: '',
    businessDomain: '',
  });

  async function load() {
    setLoading(true);
    try {
      const result = await api<IntegrationDetail>('/admin/integration');
      setDetail(result);
      setForm({
        miniappAppId: result.miniappAppId ?? '',
        // 密钥不回显，输入框始终从空开始
        miniappAppSecret: '',
        paymentProvider: result.paymentProvider,
        wechatPayMchId: result.wechatPayMchId ?? '',
        wechatPayCertSerial: result.wechatPayCertSerial ?? '',
        wechatPayNotifyUrl: result.wechatPayNotifyUrl ?? '',
        wechatPayPublicKeyId: result.wechatPayPublicKeyId ?? '',
        orderPaid: result.subscribeTemplateIds.orderPaid,
        orderShipped: result.subscribeTemplateIds.orderShipped,
        refundResult: result.subscribeTemplateIds.refundResult,
        pickupReady: result.subscribeTemplateIds.pickupReady,
        pickupExpiring: result.subscribeTemplateIds.pickupExpiring,
        deliveryAccepted: result.subscribeTemplateIds.deliveryAccepted,
        deliveryDone: result.subscribeTemplateIds.deliveryDone,
        templateFields: JSON.stringify(result.subscribeTemplateFields ?? {}, null, 2),
        apiBaseUrl: result.apiBaseUrl ?? '',
        businessDomain: result.businessDomain ?? '',
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

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      toast('只有超级管理员可以修改集成配置', 'error');
      return;
    }
    setSaving(true);
    try {
      let templateFields: Record<string, Record<string, string>> = {};
      const raw = form.templateFields.trim();
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('字段映射必须是 JSON 对象');
          }
          templateFields = parsed as Record<string, Record<string, string>>;
        } catch (err) {
          toast(err instanceof Error ? err.message : '字段映射不是合法 JSON', 'error');
          setSaving(false);
          return;
        }
      }

      await api('/admin/integration', {
        method: 'PATCH',
        body: {
          miniappAppId: form.miniappAppId.trim(),
          // 留空表示不修改已保存的 AppSecret
          ...(form.miniappAppSecret.trim()
            ? { miniappAppSecret: form.miniappAppSecret.trim() }
            : {}),
          paymentProvider: form.paymentProvider,
          wechatPayMchId: form.wechatPayMchId.trim(),
          wechatPayCertSerial: form.wechatPayCertSerial.trim(),
          wechatPayNotifyUrl: form.wechatPayNotifyUrl.trim(),
          wechatPayPublicKeyId: form.wechatPayPublicKeyId.trim(),
          subscribeTemplateIds: {
            orderPaid: form.orderPaid.trim(),
            orderShipped: form.orderShipped.trim(),
            refundResult: form.refundResult.trim(),
            pickupReady: form.pickupReady.trim(),
            pickupExpiring: form.pickupExpiring.trim(),
            deliveryAccepted: form.deliveryAccepted.trim(),
            deliveryDone: form.deliveryDone.trim(),
          },
          subscribeTemplateFields: templateFields,
          apiBaseUrl: form.apiBaseUrl.trim(),
          businessDomain: form.businessDomain.trim(),
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

  async function handleUpload(field: SecretField, file: File | undefined) {
    if (!file) return;
    if (file.size > SECRET_MAX_BYTES) {
      toast('文件不能超过 200KB', 'error');
      return;
    }
    setUploading(field);
    try {
      const contentBase64 = await fileToBase64(file);
      await api(`/admin/integration/secrets/${field}`, {
        method: 'POST',
        body: { fileName: file.name, contentBase64 },
      });
      toast('已上传');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setUploading(null);
    }
  }

  async function handleRemoveSecret(field: SecretField, label: string) {
    if (!window.confirm(`确定删除已上传的${label}吗？删除后相关能力将不可用。`)) return;
    try {
      await api(`/admin/integration/secrets/${field}`, { method: 'DELETE' });
      toast('已删除');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function clearAppSecret() {
    if (!window.confirm('确定清除已保存的 AppSecret 吗？清除后小程序登录会回到本地模拟。')) return;
    try {
      await api('/admin/integration', {
        method: 'PATCH',
        body: { miniappAppSecret: '' },
      });
      toast('已清除');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  function secretMeta(field: SecretField): SecretMeta {
    const meta =
      field === 'miniappUploadKey'
        ? detail?.miniappUploadKey
        : field === 'wechatPayApiV3Key'
          ? detail?.wechatPayApiV3Key
          : field === 'wechatPayPrivateKey'
            ? detail?.wechatPayPrivateKey
            : detail?.wechatPayPublicKey;
    return meta ?? { configured: false, fileName: null };
  }

  if (loading) {
    return (
      <>
        <PageHeader title="集成配置" />
        <div className="table-loading">加载中…</div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="集成配置"
        desc="小程序登录、微信支付、订阅消息与域名参数；密钥文件只存服务端，不回显内容"
      />

      <form onSubmit={handleSave}>
        <Card title="小程序登录">
          {!canWrite && (
            <p className="small muted" style={{ marginTop: 0 }}>
              当前角色仅可查看集成配置。
            </p>
          )}
          <div className="grid grid-2">
            <Field label="小程序 AppID" hint="微信公众平台 → 开发管理 → 开发设置">
              <input
                className="input"
                value={form.miniappAppId}
                disabled={!canWrite}
                placeholder="wx0000000000000000"
                onChange={(e) => setField('miniappAppId', e.target.value)}
              />
            </Field>
          </div>
          <div className="field">
            <span className="field-label">
              小程序 AppSecret{' '}
              {detail?.miniappAppSecret.configured ? (
                <Tag tone="ok">已配置</Tag>
              ) : (
                <Tag tone="warn">未配置</Tag>
              )}
            </span>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={form.miniappAppSecret}
                disabled={!canWrite}
                placeholder={
                  detail?.miniappAppSecret.configured
                    ? '已配置，留空表示不修改'
                    : '请输入 32 位 AppSecret'
                }
                onChange={(e) => setField('miniappAppSecret', e.target.value)}
              />
              {detail?.miniappAppSecret.configured && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!canWrite}
                  onClick={() => void clearAppSecret()}
                >
                  清除
                </Button>
              )}
            </div>
            <span className="field-hint">
              保存后小程序登录切换为真实 jscode2session；密钥不回显，留空表示保持原值
            </span>
          </div>
          <SecretRow
            field="miniappUploadKey"
            label="代码上传密钥"
            hint="微信公众平台 → 开发管理 → 小程序代码上传 → 下载密钥；上传前需把服务器 IP 加入该密钥的 IP 白名单"
            meta={secretMeta('miniappUploadKey')}
            disabled={!canWrite}
            uploading={uploading === 'miniappUploadKey'}
            onUpload={(file) => void handleUpload('miniappUploadKey', file)}
            onRemove={() => void handleRemoveSecret('miniappUploadKey', '代码上传密钥')}
          />
        </Card>

        <Card title="微信支付">
          <div className="grid grid-2">
            <Field label="支付渠道" hint="切到 wechat 后小程序将调起真实微信收银台">
              <select
                className="input"
                value={form.paymentProvider}
                disabled={!canWrite}
                onChange={(e) => setField('paymentProvider', e.target.value as 'mock' | 'wechat')}
              >
                <option value="mock">mock（模拟支付）</option>
                <option value="wechat">wechat（微信支付）</option>
              </select>
            </Field>
            <Field label="商户号 MchID">
              <input
                className="input"
                value={form.wechatPayMchId}
                disabled={!canWrite}
                placeholder="1900000001"
                onChange={(e) => setField('wechatPayMchId', e.target.value)}
              />
            </Field>
            <Field label="商户证书序列号">
              <input
                className="input"
                value={form.wechatPayCertSerial}
                disabled={!canWrite}
                placeholder="证书序列号"
                onChange={(e) => setField('wechatPayCertSerial', e.target.value)}
              />
            </Field>
            <Field label="支付回调地址" hint="需为 https 公网地址，指向 /api/payments/callback">
              <input
                className="input"
                value={form.wechatPayNotifyUrl}
                disabled={!canWrite}
                placeholder="https://car.aition.art/api/payments/callback"
                onChange={(e) => setField('wechatPayNotifyUrl', e.target.value)}
              />
            </Field>
            <Field
              label="微信支付公钥 ID"
              hint="公钥模式填写 PUB_KEY_ID_...；平台证书模式留空"
            >
              <input
                className="input"
                value={form.wechatPayPublicKeyId}
                disabled={!canWrite}
                placeholder="PUB_KEY_ID_..."
                onChange={(e) => setField('wechatPayPublicKeyId', e.target.value)}
              />
            </Field>
          </div>
          <SecretRow
            field="wechatPayApiV3Key"
            label="APIv3 密钥"
            hint="上传包含 32 位 APIv3 密钥的 .txt 文件"
            meta={secretMeta('wechatPayApiV3Key')}
            disabled={!canWrite}
            uploading={uploading === 'wechatPayApiV3Key'}
            onUpload={(file) => void handleUpload('wechatPayApiV3Key', file)}
            onRemove={() => void handleRemoveSecret('wechatPayApiV3Key', 'APIv3 密钥')}
          />
          <SecretRow
            field="wechatPayPrivateKey"
            label="商户 API 私钥"
            hint="上传 apiclient_key.pem（或 .p12 / .pfx）"
            meta={secretMeta('wechatPayPrivateKey')}
            disabled={!canWrite}
            uploading={uploading === 'wechatPayPrivateKey'}
            onUpload={(file) => void handleUpload('wechatPayPrivateKey', file)}
            onRemove={() => void handleRemoveSecret('wechatPayPrivateKey', '商户 API 私钥')}
          />
          <SecretRow
            field="wechatPayPublicKey"
            label="微信支付公钥"
            hint="商户平台 → API 安全 → 微信支付公钥，下载 pub_key.pem；公钥模式必填"
            meta={secretMeta('wechatPayPublicKey')}
            disabled={!canWrite}
            uploading={uploading === 'wechatPayPublicKey'}
            onUpload={(file) => void handleUpload('wechatPayPublicKey', file)}
            onRemove={() => void handleRemoveSecret('wechatPayPublicKey', '微信支付公钥')}
          />
        </Card>

        <Card title="订阅消息">
          <div className="grid grid-2">
            <Field label="订单支付通知模板 ID">
              <input
                className="input"
                value={form.orderPaid}
                disabled={!canWrite}
                onChange={(e) => setField('orderPaid', e.target.value)}
              />
            </Field>
            <Field label="订单发货通知模板 ID">
              <input
                className="input"
                value={form.orderShipped}
                disabled={!canWrite}
                onChange={(e) => setField('orderShipped', e.target.value)}
              />
            </Field>
            <Field label="退款结果通知模板 ID">
              <input
                className="input"
                value={form.refundResult}
                disabled={!canWrite}
                onChange={(e) => setField('refundResult', e.target.value)}
              />
            </Field>
            <Field label="自提待取通知模板 ID">
              <input
                className="input"
                value={form.pickupReady}
                disabled={!canWrite}
                onChange={(e) => setField('pickupReady', e.target.value)}
              />
            </Field>
            <Field label="自提到期提醒模板 ID">
              <input
                className="input"
                value={form.pickupExpiring}
                disabled={!canWrite}
                onChange={(e) => setField('pickupExpiring', e.target.value)}
              />
            </Field>
            <Field label="配送接单通知模板 ID">
              <input
                className="input"
                value={form.deliveryAccepted}
                disabled={!canWrite}
                onChange={(e) => setField('deliveryAccepted', e.target.value)}
              />
            </Field>
            <Field label="配送送达通知模板 ID">
              <input
                className="input"
                value={form.deliveryDone}
                disabled={!canWrite}
                onChange={(e) => setField('deliveryDone', e.target.value)}
              />
            </Field>
          </div>
          <Field
            label="模板字段映射（JSON）"
            hint='键为微信模板字段名，值为变量：orderNo / payable / items / paidAt / trackingNo / expressName / shippedAt / refundNo / amount / status / refundedAt / pickupCode / storeName / pickupAt / expiresAt / courierName / courierPhone / acceptedAt / deliveredAt。留空 {} 使用默认映射；字段名必须与公众平台模板一致，否则微信返回 47003。'
          >
            <textarea
              className="input"
              rows={8}
              style={{ fontFamily: 'monospace' }}
              value={form.templateFields}
              disabled={!canWrite}
              onChange={(e) => setField('templateFields', e.target.value)}
            />
          </Field>
        </Card>

        <Card title="域名与地址">
          <div className="grid grid-2">
            <Field label="API 地址" hint="真机联调时小程序请求的服务端地址">
              <input
                className="input"
                value={form.apiBaseUrl}
                disabled={!canWrite}
                placeholder="https://api.example.com/api"
                onChange={(e) => setField('apiBaseUrl', e.target.value)}
              />
            </Field>
            <Field label="小程序业务域名" hint="需在微信公众平台配置为合法域名">
              <input
                className="input"
                value={form.businessDomain}
                disabled={!canWrite}
                placeholder="api.example.com"
                onChange={(e) => setField('businessDomain', e.target.value)}
              />
            </Field>
          </div>
        </Card>

        <div className="row-between">
          <span className="small muted">
            {detail?.updatedAt ? `最近更新：${formatDate(detail.updatedAt)}` : ''}
          </span>
          <Button type="submit" loading={saving} disabled={!canWrite}>
            保存配置
          </Button>
        </div>
      </form>
    </>
  );
}
