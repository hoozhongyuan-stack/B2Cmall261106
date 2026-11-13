import { Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';

import { api } from '../../api/client';
import QrCode from '../../components/QrCode';
import { formatDate, money } from '../../utils/format';

import './index.css';

interface OrderSummary {
  orderNo: string;
  payableCents: number;
  fulfillmentType: string;
  pickupCode: string | null;
  pickupCodeExpiresAt: string | null;
  store: { name: string; address: string } | null;
  items: { quantity: number }[];
}

export default function Page() {
  const router = useRouter();
  const orderId = router.params.orderId ?? '';
  const success = (router.params.status ?? 'success') === 'success';
  const [order, setOrder] = useState<OrderSummary | null>(null);

  useEffect(() => {
    if (!orderId) return;
    void api<OrderSummary>(`/orders/${orderId}`)
      .then(setOrder)
      .catch(() => undefined);
  }, [orderId]);

  const itemCount = order?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const isPickup = order?.fulfillmentType === 'PICKUP';
  const showPickupCode = Boolean(success && isPickup && order?.pickupCode);

  return (
    <View className="page pay-result">
      <View className={`pay-mark${success ? '' : ' pay-mark--fail'}`}>
        <Text className="pay-mark-icon">{success ? '✓' : '!'}</Text>
      </View>
      <Text className="pay-title">{success ? '支付成功' : '支付结果待确认'}</Text>
      <Text className="muted small pay-hint">
        {!success
          ? '如已扣款，请稍后在订单中查看状态'
          : isPickup
            ? '请到店出示核销二维码取货'
            : '我们会尽快为你打包发货，请留意物流通知'}
      </Text>

      {order && (
        <View className="card pay-receipt">
          <View className="row-between">
            <Text className="muted small">订单号</Text>
            <Text className="small">{order.orderNo}</Text>
          </View>
          <View className="row-between">
            <Text className="muted small">实付金额</Text>
            <Text className="price">{money(order.payableCents)}</Text>
          </View>
          <View className="row-between">
            <Text className="muted small">商品件数</Text>
            <Text className="small">{itemCount} 件</Text>
          </View>
          {isPickup && order.store && (
            <View className="row-between">
              <Text className="muted small">自提门店</Text>
              <Text className="small">{order.store.name}</Text>
            </View>
          )}
        </View>
      )}

      {showPickupCode && order?.pickupCode && (
        <View className="card pay-pickup">
          <Text className="pay-pickup-title">自提核销二维码</Text>
          <Text className="pay-pickup-code">{order.pickupCode}</Text>
          <QrCode value={order.pickupCode} size={320} />
          <Text className="muted tiny">到店向店员出示二维码，或报 8 位核销码</Text>
          {order.pickupCodeExpiresAt && (
            <Text className="muted tiny">
              有效期至 {formatDate(order.pickupCodeExpiresAt, true)}
            </Text>
          )}
        </View>
      )}

      <View className="pay-actions">
        <View
          className="btn btn--primary btn--block"
          onClick={() => {
            if (!orderId) {
              void Taro.redirectTo({ url: '/pages/orders/index' });
              return;
            }
            void Taro.redirectTo({ url: `/pages/order-detail/index?id=${orderId}` });
          }}
        >
          查看订单
        </View>
        <View
          className="btn btn--ghost btn--block"
          onClick={() => Taro.reLaunch({ url: '/pages/home/index' })}
        >
          继续逛逛
        </View>
      </View>
    </View>
  );
}
