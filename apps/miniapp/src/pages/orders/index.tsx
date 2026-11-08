import { Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useState } from 'react';
import {
  ORDER_STATUS,
  ORDER_STATUS_LABEL,
  buyerActions,
  type OrderStatus,
} from '@shanye/shared/src/orderState';

import { api, showError } from '../../api/client';
import { Empty, Loading, Price, ProductThumb } from '../../components/common';
import { formatDate, money } from '../../utils/format';
import { payOrder } from '../../utils/pay';

import './index.css';

interface OrderItemLite {
  title: string;
  specText: string;
  imageKey: string | null;
  quantity: number;
  priceCents: number;
}

interface OrderRow {
  id: string;
  orderNo: string;
  status: string;
  payableCents: number;
  createdAt: string;
  payDeadlineAt: string;
  itemCount: number;
  items: OrderItemLite[];
}

const TABS = [
  { key: '', label: '全部' },
  { key: ORDER_STATUS.PENDING_PAYMENT, label: '待付款' },
  { key: ORDER_STATUS.PAID, label: '待发货' },
  { key: ORDER_STATUS.SHIPPED, label: '待收货' },
  { key: ORDER_STATUS.COMPLETED, label: '已完成' },
];

export default function Page() {
  const router = useRouter();
  const [status, setStatus] = useState(router.params.status ?? '');
  const [items, setItems] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async (nextStatus: string) => {
    setLoading(true);
    try {
      const res = await api<{ items: OrderRow[] }>('/orders', {
        query: { status: nextStatus || undefined },
      });
      setItems(res.items);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => {
    void load(status);
  });

  const changeTab = (key: string) => {
    setStatus(key);
    void load(key);
  };

  const pay = async (order: OrderRow) => {
    try {
      const outcome = await payOrder(order.id);
      await Taro.redirectTo({
        url: `/pages/pay-result/index?orderId=${order.id}&status=${outcome === 'paid' ? 'success' : 'pending'}`,
      });
    } catch (err) {
      showError(err);
    }
  };

  const cancel = async (order: OrderRow) => {
    const modal = await Taro.showModal({ title: '取消订单', content: '确定取消这笔订单吗？' });
    if (!modal.confirm) return;
    try {
      await api(`/orders/${order.id}/cancel`, { method: 'POST' });
      await Taro.showToast({ title: '已取消', icon: 'success' });
      await load(status);
    } catch (err) {
      showError(err);
    }
  };

  const confirm = async (order: OrderRow) => {
    const modal = await Taro.showModal({ title: '确认收货', content: '确认已收到商品？' });
    if (!modal.confirm) return;
    try {
      await api(`/orders/${order.id}/confirm`, { method: 'POST' });
      await Taro.showToast({ title: '已确认收货', icon: 'success' });
      await load(status);
    } catch (err) {
      showError(err);
    }
  };

  const goReview = async (order: OrderRow) => {
    try {
      const detail = await api<{ items: { id: string }[] }>(`/orders/${order.id}`);
      const first = detail.items[0];
      if (!first) return;
      void Taro.navigateTo({
        url: `/pages/review/create/index?orderItemId=${first.id}&orderId=${order.id}`,
      });
    } catch (err) {
      showError(err);
    }
  };

  return (
    <View className="page orders-page">
      <View className="tabs">
        {TABS.map((tab) => (
          <View
            key={tab.key || 'all'}
            className={`tab${status === tab.key ? ' tab--on' : ''}`}
            onClick={() => changeTab(tab.key)}
          >
            {tab.label}
          </View>
        ))}
      </View>

      {loading && !items.length && <Loading />}
      {!loading && !items.length && <Empty text="暂时没有相关订单" />}

      {items.map((order) => {
        const actions = buyerActions(order.status as OrderStatus);
        return (
          <View key={order.id} className="card order-card">
            <View
              className="row-between order-head"
              onClick={() =>
                Taro.navigateTo({ url: `/pages/order-detail/index?id=${order.id}` })
              }
            >
              <Text className="muted tiny">{order.orderNo}</Text>
              <Text className="order-status">{ORDER_STATUS_LABEL[order.status as OrderStatus]}</Text>
            </View>
            <Text className="muted tiny order-date">{formatDate(order.createdAt, true)}</Text>

            <View
              className="order-items"
              onClick={() =>
                Taro.navigateTo({ url: `/pages/order-detail/index?id=${order.id}` })
              }
            >
              {order.items.map((item, index) => (
                <View key={`${order.id}-${index}`} className="order-item">
                  <ProductThumb imageKey={item.imageKey} title={item.title} />
                  <View className="grow col">
                    <Text className="clamp-2">{item.title}</Text>
                    <Text className="muted tiny">{item.specText}</Text>
                    <View className="row-between">
                      <Text className="small">{money(item.priceCents)}</Text>
                      <Text className="muted tiny">x{item.quantity}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>

            <View className="row-between order-total">
              <Text className="muted tiny">共 {order.itemCount} 件</Text>
              <View className="row">
                <Text className="tiny muted">实付</Text>
                <Price cents={order.payableCents} />
              </View>
            </View>

            <View className="order-actions">
              {actions.includes('cancel') && (
                <View className="btn btn--sm order-btn" onClick={() => cancel(order)}>
                  取消订单
                </View>
              )}
              {actions.includes('pay_success') && (
                <View className="btn btn--sm btn--primary order-btn" onClick={() => pay(order)}>
                  去支付
                </View>
              )}
              {actions.includes('confirm') && (
                <View
                  className="btn btn--sm btn--primary order-btn"
                  onClick={() => confirm(order)}
                >
                  确认收货
                </View>
              )}
              {order.status === ORDER_STATUS.SHIPPED && (
                <View
                  className="btn btn--sm order-btn"
                  onClick={() =>
                    Taro.navigateTo({ url: `/pages/shipment/index?id=${order.id}` })
                  }
                >
                  查看物流
                </View>
              )}
              {order.status === ORDER_STATUS.COMPLETED && (
                <View
                  className="btn btn--sm btn--ghost order-btn"
                  onClick={() => goReview(order)}
                >
                  去评价
                </View>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}
