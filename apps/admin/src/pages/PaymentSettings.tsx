import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, ApiError } from '../api/client';
import { toast } from '../components/toast';
import { Card, KeyValue, PageHeader, Tag } from '../components/ui';

interface IntegrationSummary {
  paymentProvider: 'mock' | 'wechat';
  wechatPayMchId: string | null;
  wechatPayApiV3Key: { configured: boolean };
  wechatPayPrivateKey: { configured: boolean };
}

const CHECKLIST = [
  '商户号、证书序列号与小程序 AppID 属于同一商户主体',
  '已上传 APIv3 密钥（32 位）与商户 API 私钥（PEM）',
  '公钥模式需额外填写微信支付公钥 ID 并上传微信支付公钥',
  '支付回调地址为 https://car.aition.art/api/payments/callback',
  '小程序 request 合法域名已包含 https://car.aition.art',
];

export default function PaymentSettings() {
  const [config, setConfig] = useState<IntegrationSummary | null>(null);

  useEffect(() => {
    api<IntegrationSummary>('/admin/integration')
      .then(setConfig)
      .catch((err) => toast(err instanceof ApiError ? err.message : '读取支付配置失败', 'error'));
  }, []);

  const wechat = config?.paymentProvider === 'wechat';

  return (
    <>
      <PageHeader
        title="支付设置"
        desc="渠道与商户参数在「集成配置」中维护，这里展示当前运行状态"
      />

      <Card title="当前支付渠道" extra={<Link to="/settings/integration">去集成配置</Link>}>
        <KeyValue
          items={[
            {
              label: '已配置渠道',
              value: (
                <span className="row">
                  <span className="mono">provider = {config?.paymentProvider ?? '—'}</span>
                  {config && (
                    <Tag tone={wechat ? 'warn' : 'ok'}>{wechat ? '微信支付' : '模拟支付'}</Tag>
                  )}
                </span>
              ),
            },
            {
              label: '运行状态',
              value: wechat ? (
                <span className="small muted">
                  小程序下单后调起微信收银台，支付结果以回调验签通过为准。
                </span>
              ) : (
                <span className="small muted">无需真实商户号即可完成支付闭环</span>
              ),
            },
            { label: '商户号', value: <span className="mono">{config?.wechatPayMchId ?? '未配置'}</span> },
            {
              label: 'APIv3 密钥',
              value: config?.wechatPayApiV3Key.configured ? (
                <Tag tone="ok">已上传</Tag>
              ) : (
                <Tag tone="warn">未配置</Tag>
              ),
            },
            {
              label: '商户私钥',
              value: config?.wechatPayPrivateKey.configured ? (
                <Tag tone="ok">已上传</Tag>
              ) : (
                <Tag tone="warn">未配置</Tag>
              ),
            },
            { label: '支付回调', value: <span className="mono">POST /api/payments/callback</span> },
            {
              label: '小程序确认支付',
              value: <span className="mono">POST /payments/mock/confirm</span>,
            },
          ]}
        />
      </Card>

      <Card title="模拟支付流程">
        <p style={{ marginTop: 0 }}>
          小程序调用下单支付接口拿到模拟参数后，用户点击「确认支付」即可请求 mock 确认接口，
          服务端走与真实回调完全相同的处理逻辑，完成订单状态推进、积分发放与库存扣减。
        </p>
        <KeyValue
          items={[
            { label: '回调地址', value: <span className="mono">POST /api/payments/callback</span> },
            { label: '确认支付', value: <span className="mono">POST /payments/mock/confirm</span> },
            { label: '幂等策略', value: '支付单 outTradeNo 唯一，重复通知幂等处理' },
          ]}
        />
      </Card>

      <Card title="微信支付配置检查">
        <p style={{ marginTop: 0 }} className="muted small">
          任一必填项缺失时，下单接口会返回「微信支付未配置完整」，并列出缺失项。
        </p>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 2 }}>
          {CHECKLIST.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </Card>

      <Card title="安全提示">
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 2 }}>
          <li>回调必须验签并校验金额，避免伪造通知造成资损。</li>
          <li>支付与退款均以唯一单号保证幂等，请勿在渠道侧重复发起。</li>
          <li>商户证书与密钥只存放在服务端，不要下发到小程序或后台前端。</li>
        </ul>
      </Card>
    </>
  );
}
