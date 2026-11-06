import { Input, Text, Textarea, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useState } from 'react';

import { api, showError } from '../../../api/client';

import './index.css';

const REASONS = ['商品与描述不符', '商品破损或变质', '少件 / 漏发', '不想要了'];

export default function Page() {
  const router = useRouter();
  const orderItemId = router.params.orderItemId ?? '';
  const [type, setType] = useState<'REFUND_ONLY' | 'RETURN_REFUND'>('REFUND_ONLY');
  const [reason, setReason] = useState(REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [description, setDescription] = useState('');
  const [evidenceKey, setEvidenceKey] = useState('');
  const [refundYuan, setRefundYuan] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!orderItemId) {
      await Taro.showToast({ title: '缺少订单商品信息', icon: 'none' });
      return;
    }
    const finalReason = customReason.trim() || reason;
    if (!finalReason) {
      await Taro.showToast({ title: '请选择售后原因', icon: 'none' });
      return;
    }
    const amount = refundYuan.trim() ? Math.round(Number(refundYuan) * 100) : undefined;
    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
      await Taro.showToast({ title: '退款金额格式不正确', icon: 'none' });
      return;
    }

    setSubmitting(true);
    try {
      await api('/after-sales', {
        method: 'POST',
        body: {
          orderItemId,
          type,
          reason: finalReason,
          description: description.trim() || undefined,
          ...(amount !== undefined ? { refundCents: amount } : {}),
          ...(evidenceKey.trim() ? { evidence: [evidenceKey.trim()] } : {}),
        },
      });
      await Taro.showToast({ title: '已提交', icon: 'success' });
      await Taro.redirectTo({ url: '/pages/after-sale/list/index' });
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className="page page--bar">
      <View className="card">
        <Text className="section-title as-title">售后类型</Text>
        <View className="as-types">
          <View
            className={`as-type${type === 'REFUND_ONLY' ? ' as-type--on' : ''}`}
            onClick={() => setType('REFUND_ONLY')}
          >
            <Text className="small as-type-name">仅退款</Text>
            <Text className="muted tiny">未收到货或无需退回商品</Text>
          </View>
          <View
            className={`as-type${type === 'RETURN_REFUND' ? ' as-type--on' : ''}`}
            onClick={() => setType('RETURN_REFUND')}
          >
            <Text className="small as-type-name">退货退款</Text>
            <Text className="muted tiny">需要寄回商品后退款</Text>
          </View>
        </View>
      </View>

      <View className="card">
        <Text className="section-title as-title">售后原因</Text>
        <View className="as-reasons">
          {REASONS.map((item) => (
            <View
              key={item}
              className={`tag as-reason${reason === item && !customReason ? ' tag--brand' : ''}`}
              onClick={() => {
                setReason(item);
                setCustomReason('');
              }}
            >
              {item}
            </View>
          ))}
        </View>
        <View className="field as-custom">
          <Text className="field-label">其他原因（选填，填写后优先）</Text>
          <Input
            className="input"
            value={customReason}
            placeholder="请描述具体原因"
            onInput={(e) => setCustomReason(e.detail.value)}
          />
        </View>
      </View>

      <View className="card">
        <View className="field">
          <Text className="field-label">问题描述</Text>
          <Textarea
            className="textarea"
            value={description}
            maxlength={200}
            placeholder="补充说明有助于更快处理"
            onInput={(e) => setDescription(e.detail.value)}
          />
        </View>
        <View className="field">
          <Text className="field-label">凭证图片 Key（选填，本期不支持上传）</Text>
          <Input
            className="input"
            value={evidenceKey}
            placeholder="留空即可"
            onInput={(e) => setEvidenceKey(e.detail.value)}
          />
        </View>
        <View className="field">
          <Text className="field-label">退款金额（元，选填）</Text>
          <Input
            className="input"
            type="digit"
            value={refundYuan}
            placeholder="留空按可退上限执行"
            onInput={(e) => setRefundYuan(e.detail.value)}
          />
        </View>
        <Text className="muted tiny">退款上限为商品实付金额，运费按整单退还规则处理</Text>
      </View>

      <View className="bottom-bar">
        <View
          className={`btn btn--primary btn--block${submitting ? ' btn--disabled' : ''}`}
          onClick={submit}
        >
          {submitting ? '提交中…' : '提交申请'}
        </View>
      </View>
    </View>
  );
}
