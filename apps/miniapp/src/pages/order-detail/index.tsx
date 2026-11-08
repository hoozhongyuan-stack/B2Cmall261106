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
import QrCode from '../../components/QrCode';
import { countdown, formatDate, money } from '../../utils/format';
import { payOrder } from '../../utils/pay';

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

interface StoreBrief {
  id: string;
  name: string;
  phone: string | null;
  region: string;
  address: string;
  businessHours: Record<string, string[][]>;
}

interface OrderDetail {
  id: string;
  orderNo: string;
  status: string;
  fulfillmentType: 'EXPRESS' | 'DELIVERY' | 'PICKUP';
  storeId: string | null;
  storeName: string | null;
  store: StoreBrief | null;
  pickupCode: string | null;
  pickupAt: string | null;
  pickupCodeExpiresAt: string | null;
  deliverySlot: string | null;
  delivery: {
    status: string;
    courierName: string | null;
    courierPhone: string | null;
    acceptedAt: string | null;
    deliveredAt: string | null;
    remark: string | null;
  } | null;
  pickupVerifiedAt: string | null;
  pickupVerification: {
    method: string;
    verifiedBy: string | null;
    verifiedAt: string;
    note: string | null;
  } | null;
  payDeadlineAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  createdAt: string;
  remark: string | null;
  address: {
    receiver?: string;
    phone?: string;
    region?: string;
    detail?: string;
  } | null;
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

/** 自提核销剩余时间：天/小时粒度即可，避免大数字秒级跳动 */
function pickupLeft(expiresAt: string, now: number): string {
  const left = new Date(expiresAt).getTime() - now;
  if (left <= 0) return '已超过自提期限';
  const hours = Math.floor(left / 3_600_000);
  if (hours >= 24) return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return `${hours} 小时 ${minutes} 分钟`;
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const DELIVERY_STATUS_LABEL: Record<string, string> = {
  PENDING: '待接单',
  ACCEPTED: '配送中',
  DELIVERED: '已送达',
  CANCELLED: '已取消',
};

/** 门店在自提当天的营业时间，缺省时返回空串 */
function businessHoursOf(store: StoreBrief | null, at: string | null): string {
  if (!store) return '';
  const day = at ? new Date(at) : new Date();
  const ranges = store.businessHours[WEEKDAYS[day.getDay()]];
  if (!ranges?.length) return '';
  return ranges.map(([open, close]) => `${open}-${close}`).join('、');
}

export default function Page() {
  const router = useRouter();
  const id = router.params.id ?? '';
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [balanceCents, setBalanceCents] = useState(0);

  const load = async () => {
    try {
      const [orderData, membership] = await Promise.all([
        api<OrderDetail>(`/orders/${id}`),
        api<{ balanceCents: number }>('/member-cards/mine').catch(() => null),
      ]);
      setOrder(orderData);
      setBalanceCents(membership?.balanceCents ?? 0);
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
  const pickupPending =
    order?.fulfillmentType === 'PICKUP' && Boolean(order.pickupCode) && !order.pickupVerifiedAt;

  useEffect(() => {
    if (!pending && !pickupPending) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending, pickupPending]);

  const pay = async () => {
    if (!order) return;
    try {
      const outcome = await payOrder(order.id);
      await Taro.redirectTo({
        url: `/pages/pay-result/index?orderId=${order.id}&status=${outcome === 'paid' ? 'success' : 'pending'}`,
      });
    } catch (err) {
      showError(err);
    }
  };

  const payWithBalance = async () => {
    if (!order) return;
    const modal = await Taro.showModal({
      title: '余额支付',
      content: `将从储值余额扣除 ${money(order.amount.payableCents)}，支付后不支持改回微信支付。`,
    });
    if (!modal.confirm) return;
    try {
      await api(`/orders/${order.id}/pay-balance`, { method: 'POST' });
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

  const isPickup = order.fulfillmentType === 'PICKUP';
  const isDelivery = order.fulfillmentType === 'DELIVERY';
  const actions = buyerActions(order.status as OrderStatus, order.fulfillmentType);
  const canApplyAfterSale = actions.includes('refund_apply');
  const statusLabel =
    isPickup && order.status === ORDER_STATUS.PAID
      ? '待自提'
      : isDelivery && order.status === ORDER_STATUS.PAID
        ? '待接单'
        : isDelivery && order.status === ORDER_STATUS.SHIPPED
          ? '配送中'
          : ORDER_STATUS_LABEL[order.status as OrderStatus];

  const callCourier = (phone: string) => {
    void Taro.makePhoneCall({ phoneNumber: phone }).catch(() => {
      void Taro.showToast({ title: `配送员电话 ${phone}`, icon: 'none' });
    });
  };

  return (
    <View className="page page--bar">
      <View className="card od-head">
        <View className="row-between">
          <Text className="od-status">{statusLabel}</Text>
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

      {isPickup ? (
        <View className="card">
          <Text className="section-title od-section">自提门店</Text>
          <Text className="od-store-name">{order.store?.name ?? order.storeName ?? '—'}</Text>
          <Text className="muted small od-address">
            {[order.store?.region, order.store?.address].filter(Boolean).join(' ') || '—'}
          </Text>
          <View className="row-between od-info">
            <Text className="small muted">自提时间</Text>
            <Text className="small">{formatDate(order.pickupAt, true)}</Text>
          </View>
          {businessHoursOf(order.store, order.pickupAt) && (
            <View className="row-between od-info">
              <Text className="small muted">营业时间</Text>
              <Text className="small">{businessHoursOf(order.store, order.pickupAt)}</Text>
            </View>
          )}
          {order.store?.phone && (
            <View className="row-between od-info">
              <Text className="small muted">门店电话</Text>
              <Text className="small">{order.store.phone}</Text>
            </View>
          )}
          {order.address?.phone && (
            <View className="row-between od-info">
              <Text className="small muted">联系手机</Text>
              <Text className="small">{order.address.phone}</Text>
            </View>
          )}
        </View>
      ) : (
        <View className="card">
          <Text className="section-title od-section">收货信息</Text>
          <View className="row-between">
            <Text className="small">{order.address?.receiver}</Text>
            <Text className="muted small">{order.address?.phone}</Text>
          </View>
          <Text className="muted small od-address">
            {order.address?.region} {order.address?.detail}
          </Text>
        </View>
      )}

      {isPickup && order.pickupCode && (
        <View className="card">
          <Text className="section-title od-section">自提核销码</Text>
          {order.pickupVerifiedAt ? (
            <View className="col od-pickup-verified">
              <Text className="small">已完成核销</Text>
              <Text className="muted tiny">
                {formatDate(order.pickupVerifiedAt, true)}
                {order.pickupVerification?.method === 'AUTO' ? ' · 超时自动完成' : ''}
              </Text>
            </View>
          ) : (
            <View className="col od-pickup-body">
              <Text className="od-code">{order.pickupCode}</Text>
              <QrCode value={order.pickupCode} size={300} />
              <Text className="muted tiny">到店出示核销码或二维码</Text>
              {order.pickupCodeExpiresAt && (
                <Text className="muted tiny">
                  请于 {formatDate(order.pickupCodeExpiresAt, true)} 前到店 ·{' '}
                  {pickupLeft(order.pickupCodeExpiresAt, now)}
                </Text>
              )}
            </View>
          )}
        </View>
      )}

      {isDelivery && (
        <View className="card">
          <Text className="section-title od-section">配送信息</Text>
          <View className="row-between od-info">
            <Text className="small muted">预计送达</Text>
            <Text className="small">{order.deliverySlot ?? '商家安排'}</Text>
          </View>
          {order.delivery ? (
            <>
              <View className="row-between od-info">
                <Text className="small muted">配送状态</Text>
                <Text className="small">
                  {DELIVERY_STATUS_LABEL[order.delivery.status] ?? order.delivery.status}
                </Text>
              </View>
              {order.delivery.courierName && (
                <View className="row-between od-info">
                  <Text className="small muted">配送员</Text>
                  <Text className="small">{order.delivery.courierName}</Text>
                </View>
              )}
              {order.delivery.courierPhone && (
                <View
                  className="row-between od-info"
                  onClick={() => callCourier(order.delivery!.courierPhone!)}
                >
                  <Text className="small muted">配送员电话</Text>
                  <Text className="small od-link">
                    {order.delivery.courierPhone} · 联系
                  </Text>
                </View>
              )}
              {order.delivery.acceptedAt && (
                <View className="row-between od-info">
                  <Text className="small muted">接单时间</Text>
                  <Text className="small">{formatDate(order.delivery.acceptedAt, true)}</Text>
                </View>
              )}
              {order.delivery.deliveredAt && (
                <View className="row-between od-info">
                  <Text className="small muted">送达时间</Text>
                  <Text className="small">{formatDate(order.delivery.deliveredAt, true)}</Text>
                </View>
              )}
              {order.delivery.remark && (
                <Text className="muted tiny od-address">备注：{order.delivery.remark}</Text>
              )}
            </>
          ) : (
            <Text className="muted tiny od-address">商家接单后展示配送员与联系电话</Text>
          )}
        </View>
      )}

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
        {actions.includes('pay_success') && balanceCents >= order.amount.payableCents && (
          <View className="btn grow" onClick={payWithBalance}>
            余额支付
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
