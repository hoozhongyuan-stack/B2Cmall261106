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

const FLOW = [
  '新增 PaymentProvider 的微信支付实现，完成下单、签名与验签',
  '新增 RefundProvider 的微信退款实现，退款单号沿用现有幂等逻辑',
  '在支付模块注册新实现，订单与售后业务代码无需改动',
  '配置商户号、证书与回调域名，并将回调地址指向 /api/payments/callback',
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
                  微信支付实现尚未接入，下单支付会返回「渠道尚未接入」，请先切回 mock。
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

      <Card title="接入真实微信支付">
        <p style={{ marginTop: 0 }} className="muted small">
          代码已按渠道适配层拆分，业务层只依赖 PaymentProvider / RefundProvider 接口。
        </p>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 2 }}>
          {FLOW.map((item) => (
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
