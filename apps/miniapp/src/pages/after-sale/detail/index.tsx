import { Input, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useState } from 'react';
import {
  AFTER_SALE_STATUS,
  AFTER_SALE_STATUS_LABEL,
  type AfterSaleStatus,
} from '@shanye/shared/src/orderState';

import { api, showError } from '../../../api/client';
import { Empty, Loading } from '../../../components/common';
import { formatDate, money } from '../../../utils/format';

import './index.css';

interface AfterSaleDetail {
  id: string;
  afterSaleNo: string;
  type: string;
  reason: string;
  description: string | null;
  evidence: string[];
  refundCents: number;
  status: string;
  rejectReason: string | null;
  buyerTrackingNo: string | null;
  createdAt: string;
  finishedAt: string | null;
  orderNo: string | null;
  item: { title: string; specText: string; priceCents: number; quantity: number } | null;
  refund: { refundNo: string; status: string; refundedAt: string | null } | null;
}

const TYPE_LABEL: Record<string, string> = {
  REFUND_ONLY: '仅退款',
  RETURN_REFUND: '退货退款',
};

const RETURN_STEPS = ['提交申请', '商家审核', '买家寄回', '商家收货', '退款完成'];
const REFUND_STEPS = ['提交申请', '商家审核', '退款完成'];

const RETURN_PROGRESS: Record<string, number> = {
  APPLIED: 1,
  WAIT_BUYER_SHIP: 2,
  WAIT_SELLER_RECEIVE: 3,
  REFUNDING: 4,
  COMPLETED: 5,
  REJECTED: 1,
};

const REFUND_PROGRESS: Record<string, number> = {
  APPLIED: 1,
  REFUNDING: 2,
  COMPLETED: 3,
  REJECTED: 1,
};

export default function Page() {
  const router = useRouter();
  const id = router.params.id ?? '';
  const [record, setRecord] = useState<AfterSaleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [trackingNo, setTrackingNo] = useState('');

  const load = async () => {
    try {
      setRecord(await api<AfterSaleDetail>(`/after-sales/${id}`));
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => {
    void load();
  });

  const shipBack = async () => {
    if (!trackingNo.trim()) {
      await Taro.showToast({ title: '请填写寄回单号', icon: 'none' });
      return;
    }
    try {
      await api(`/after-sales/${id}/ship-back`, {
        method: 'POST',
        body: { trackingNo: trackingNo.trim() },
      });
      await Taro.showToast({ title: '已保存', icon: 'success' });
      await load();
    } catch (err) {
      showError(err);
    }
  };

  const cancel = async () => {
    const modal = await Taro.showModal({ title: '撤销售后', content: '确定撤销这次售后申请？' });
    if (!modal.confirm) return;
    try {
      await api(`/after-sales/${id}/cancel`, { method: 'POST' });
      await Taro.showToast({ title: '已撤销', icon: 'success' });
      await load();
    } catch (err) {
      showError(err);
    }
  };

  if (loading && !record) return <Loading />;
  if (!record) return <Empty text="售后单不存在" />;

  const isReturn = record.type === 'RETURN_REFUND';
  const steps = isReturn ? RETURN_STEPS : REFUND_STEPS;
  const progress = (isReturn ? RETURN_PROGRESS : REFUND_PROGRESS)[record.status] ?? 1;

  return (
    <View className="page page--bar">
      <View className="card">
        <View className="row-between">
          <Text className="asd-status">
            {AFTER_SALE_STATUS_LABEL[record.status as AfterSaleStatus]}
          </Text>
          <Text className="muted tiny">{record.afterSaleNo}</Text>
        </View>
        <View className="asd-steps">
          {steps.map((step, index) => (
            <View
              key={step}
              className={`asd-step${index < progress ? ' asd-step--done' : ''}${
                index === progress - 1 ? ' asd-step--on' : ''
              }`}
            >
              <View className="asd-step-dot" />
              <Text className="asd-step-text">{step}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className="card asd-block">
        <Text className="small asd-strong">
          {record.item?.title ?? '售后商品'}
          {record.item ? ` x${record.item.quantity}` : ''}
        </Text>
        {record.item?.specText && <Text className="muted tiny">{record.item.specText}</Text>}
        <View className="row-between asd-row">
          <Text className="small muted">售后类型</Text>
          <Text className="small">{TYPE_LABEL[record.type] ?? record.type}</Text>
        </View>
        <View className="row-between asd-row">
          <Text className="small muted">申请原因</Text>
          <Text className="small">{record.reason}</Text>
        </View>
        <View className="row-between asd-row">
          <Text className="small muted">退款金额</Text>
          <Text className="price small">{money(record.refundCents)}</Text>
        </View>
        <View className="row-between asd-row">
          <Text className="small muted">申请时间</Text>
          <Text className="small">{formatDate(record.createdAt, true)}</Text>
        </View>
        {record.orderNo && (
          <View className="row-between asd-row">
            <Text className="small muted">订单编号</Text>
            <Text className="small">{record.orderNo}</Text>
          </View>
        )}
        {record.description && (
          <View className="asd-row">
            <Text className="small muted">问题描述</Text>
            <Text className="small asd-desc">{record.description}</Text>
          </View>
        )}
        {record.evidence.length > 0 && (
          <View className="asd-row">
            <Text className="small muted">凭证</Text>
            <Text className="small asd-desc">{record.evidence.join('、')}</Text>
          </View>
        )}
        {record.rejectReason && (
          <View className="asd-row">
            <Text className="small muted">拒绝理由</Text>
            <Text className="small asd-desc">{record.rejectReason}</Text>
          </View>
        )}
        {record.buyerTrackingNo && (
          <View className="row-between asd-row">
            <Text className="small muted">寄回单号</Text>
            <Text className="small">{record.buyerTrackingNo}</Text>
          </View>
        )}
        {record.refund && (
          <View className="row-between asd-row">
            <Text className="small muted">退款单</Text>
            <Text className="small">
              {record.refund.refundNo} · {record.refund.status}
            </Text>
          </View>
        )}
      </View>

      {record.status === AFTER_SALE_STATUS.WAIT_BUYER_SHIP && (
        <View className="card">
          <Text className="section-title asd-title">填写寄回单号</Text>
          <Input
            className="input"
            value={trackingNo}
            placeholder="请输入快递单号"
            onInput={(e) => setTrackingNo(e.detail.value)}
          />
          <View className="btn btn--primary btn--block asd-submit" onClick={shipBack}>
            提交单号
          </View>
        </View>
      )}

      {record.status === AFTER_SALE_STATUS.APPLIED && (
        <View className="bottom-bar">
          <View className="btn btn--block" onClick={cancel}>
            撤销售后
          </View>
        </View>
      )}
    </View>
  );
}
