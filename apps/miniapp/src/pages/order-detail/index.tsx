import { Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';
import {
  ORDER_STATUS,
  ORDER_STATUS_LABEL,
  buyerActions,
  type OrderStatus,
} from '@shanye/shared/src/orderState';

import { api, showError } from '../../api/client';
import { Empty, Loading, Price, ProductThumb } from '../../components/common';
import { countdown, formatDate, money } from '../../utils/format';

import './index.css';

interface DetailItem {
  id: string;
  skuId: string;
  title: string;
  specText: string;
  imageKey: string | null;
  priceCents: number;
  quantity: number;
  subtotalCents: number;
}

interface OrderDetail {
  id: string;
  orderNo: string;
  status: string;
  payDeadlineAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  createdAt: string;
  remark: string | null;
  address: { receiver: string; phone: string; region: string; detail: string };
  amount: {
    goodsCents: number;
    memberDiscountCents: number;
    couponCents: number;
    freightCents: number;
    payableCents: number;
    refundedCents: number;
  };
  items: DetailItem[];
  shipment: {
    expressName: string;
    expressCode: string;
    trackingNo: string;
    shippedAt: string;
  } | null;
  payments: { provider: string; status: string; outTradeNo: string; paidAt: string | null }[];
}

export default function Page() {
  const router = useRouter();
  const id = router.params.id ?? '';
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  const load = async () => {
    try {
      setOrder(await api<OrderDetail>(`/orders/${id}`));
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => {
    void load();
  });

  const pending = order?.status === ORDER_STATUS.PENDING_PAYMENT;

  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  const pay = async () => {
    if (!order) return;
    try {
      const res = await api<{ outTradeNo: string }>(`/orders/${order.id}/pay`, { method: 'POST' });
      await api('/payments/mock/confirm', {
        method: 'POST',
        body: { outTradeNo: res.outTradeNo },
      });
      await Taro.redirectTo({
        url: `/pages/pay-result/index?orderId=${order.id}&status=success`,
      });
    } catch (err) {
      showError(err);
    }
  };

  const cancel = async () => {
    if (!order) return;
    const modal = await Taro.showModal({ title: '取消订单', content: '确定取消这笔订单吗？' });
    if (!modal.confirm) return;
    try {
      await api(`/orders/${order.id}/cancel`, { method: 'POST' });
      await Taro.showToast({ title: '已取消', icon: 'success' });
      await load();
    } catch (err) {
      showError(err);
    }
  };

  const confirm = async () => {
    if (!order) return;
    const modal = await Taro.showModal({ title: '确认收货', content: '确认已收到商品？' });
    if (!modal.confirm) return;
    try {
      await api(`/orders/${order.id}/confirm`, { method: 'POST' });
      await Taro.showToast({ title: '已确认收货', icon: 'success' });
      await load();
    } catch (err) {
      showError(err);
    }
  };

  if (loading && !order) return <Loading />;
  if (!order) return <Empty text="订单不存在" />;

  const actions = buyerActions(order.status as OrderStatus);
  const canApplyAfterSale = actions.includes('refund_apply');

  return (
    <View className="page page--bar">
      <View className="card od-head">
        <View className="row-between">
          <Text className="od-status">{ORDER_STATUS_LABEL[order.status as OrderStatus]}</Text>
          {pending && <Text className="muted small">剩余 {countdown(order.payDeadlineAt, now)}</Text>}
        </View>
        <Text className="muted tiny">{order.orderNo}</Text>
      </View>

      {order.shipment && (
        <View
          className="card od-shipment"
          onClick={() => Taro.navigateTo({ url: `/pages/shipment/index?id=${order.id}` })}
        >
          <View className="col grow">
            <Text className="small">
              {order.shipment.expressName} · {order.shipment.trackingNo}
            </Text>
            <Text className="muted tiny">
              {formatDate(order.shipment.shippedAt, true)} 已发货
            </Text>
          </View>
          <Text className="muted small">查看物流 ›</Text>
        </View>
      )}

      <View className="card">
        <Text className="section-title od-section">收货信息</Text>
        <View className="row-between">
          <Text className="small">{order.address.receiver}</Text>
          <Text className="muted small">{order.address.phone}</Text>
        </View>
        <Text className="muted small od-address">
          {order.address.region} {order.address.detail}
        </Text>
      </View>

      <View className="card">
        {order.items.map((item) => (
          <View key={item.id} className="od-item">
            <ProductThumb imageKey={item.imageKey} title={item.title} />
            <View className="grow col">
              <Text className="clamp-2">{item.title}</Text>
              <Text className="muted tiny">{item.specText}</Text>
              <View className="row-between">
                <Price cents={item.priceCents} />
                <Text className="muted tiny">x{item.quantity}</Text>
              </View>
            </View>
            {canApplyAfterSale && (
              <Text
                className="tag od-after-sale"
                onClick={() =>
                  Taro.navigateTo({
                    url: `/pages/after-sale/apply/index?orderItemId=${item.id}&orderId=${order.id}`,
                  })
                }
              >
                申请售后
              </Text>
            )}
          </View>
        ))}
      </View>

      <View className="card od-amount">
        <View className="row-between">
          <Text className="small muted">商品金额</Text>
          <Text className="small">{money(order.amount.goodsCents)}</Text>
        </View>
        <View className="row-between">
          <Text className="small muted">会员折扣</Text>
          <Text className="small">−{money(order.amount.memberDiscountCents)}</Text>
        </View>
        <View className="row-between">
          <Text className="small muted">优惠券</Text>
          <Text className="small">−{money(order.amount.couponCents)}</Text>
        </View>
        <View className="row-between">
          <Text className="small muted">运费</Text>
          <Text className="small">{money(order.amount.freightCents)}</Text>
        </View>
        {!!order.amount.refundedCents && (
          <View className="row-between">
            <Text className="small muted">已退款</Text>
            <Text className="small">{money(order.amount.refundedCents)}</Text>
          </View>
        )}
        <View className="row-between od-payable">
          <Text className="small">实付</Text>
          <Price cents={order.amount.payableCents} />
        </View>
      </View>

      {order.remark && (
        <View className="card">
          <Text className="small muted">订单备注</Text>
          <Text className="small od-remark">{order.remark}</Text>
        </View>
      )}

      <View className="card">
        <Text className="section-title od-section">订单信息</Text>
        <View className="row-between od-info">
          <Text className="small muted">下单时间</Text>
          <Text className="small">{formatDate(order.createdAt, true)}</Text>
        </View>
        {order.paidAt && (
          <View className="row-between od-info">
            <Text className="small muted">支付时间</Text>
            <Text className="small">{formatDate(order.paidAt, true)}</Text>
          </View>
        )}
        <View className="row-between od-info">
          <Text className="small muted">订单编号</Text>
          <Text className="small">{order.orderNo}</Text>
        </View>
      </View>

      <View className="bottom-bar">
        <View
          className="btn btn--ghost grow"
          onClick={() => Taro.navigateTo({ url: '/pages/after-sale/list/index' })}
        >
          售后记录
        </View>
        {actions.includes('cancel') && (
          <View className="btn grow" onClick={cancel}>
            取消订单
          </View>
        )}
        {actions.includes('pay_success') && (
          <View className="btn btn--primary grow" onClick={pay}>
            去支付
          </View>
        )}
        {actions.includes('confirm') && (
          <View className="btn btn--primary grow" onClick={confirm}>
            确认收货
          </View>
        )}
        {order.status === ORDER_STATUS.COMPLETED && (
          <View
            className="btn btn--primary grow"
            onClick={() => {
              const first = order.items[0];
              if (!first) return;
              void Taro.navigateTo({
                url: `/pages/review/create/index?orderItemId=${first.id}&orderId=${order.id}`,
              });
            }}
          >
            去评价
          </View>
        )}
      </View>
    </View>
  );
}
