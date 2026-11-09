import { Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useState } from 'react';

import { api, showError } from '../../api/client';
import { Loading } from '../../components/common';
import { money } from '../../utils/format';

import './dashboard.css';

interface Dashboard {
  store: { id: string; name: string; status: string };
  range: { start: string; end: string };
  today: {
    paidOrders: number;
    gmvCents: number;
    refundOrders: number;
    refundCents: number;
  };
  pending: { pickupOrders: number; deliveryOrders: number };
  delivery: {
    avgAcceptMinutes: number | null;
    avgDeliverMinutes: number | null;
    overdueCount: number;
  };
  stock: {
    warningCount: number;
    warnings: { skuId: string; code: string; title: string; available: number; safetyStock: number }[];
  };
}

export default function Page() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setData(await api<Dashboard>('/store-console/dashboard'));
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => {
    void load();
  });

  if (loading && !data) return <Loading />;
  if (!data) {
    return (
      <View className="page">
        <View className="card">
          <Text className="muted small">暂无看板数据</Text>
        </View>
      </View>
    );
  }

  const minutes = (value: number | null) => (value === null ? '—' : `${value} 分钟`);

  return (
    <View className="page">
      <View className="dash-hero">
        <Text className="dash-store">{data.store.name}</Text>
        <View className="dash-hero-stats">
          <View className="dash-hero-stat">
            <Text className="dash-hero-value">{data.today.paidOrders}</Text>
            <Text className="dash-hero-label">今日支付订单</Text>
          </View>
          <View className="dash-hero-stat">
            <Text className="dash-hero-value">{money(data.today.gmvCents)}</Text>
            <Text className="dash-hero-label">今日实付</Text>
          </View>
        </View>
      </View>

      <View className="card">
        <Text className="dash-title">待履约</Text>
        <View className="dash-grid">
          <View
            className="dash-cell"
            onClick={() => Taro.navigateTo({ url: '/pages/store-console/verify' })}
          >
            <Text className="dash-cell-value">{data.pending.pickupOrders}</Text>
            <Text className="dash-cell-label">待核销自提</Text>
          </View>
          <View
            className="dash-cell"
            onClick={() =>
              Taro.navigateTo({ url: '/pages/store-console/deliveries?tab=PENDING' })
            }
          >
            <Text className="dash-cell-value">{data.pending.deliveryOrders}</Text>
            <Text className="dash-cell-label">待接单配送</Text>
          </View>
        </View>
      </View>

      <View className="card">
        <Text className="dash-title">配送时效</Text>
        <View className="dash-grid dash-grid--3">
          <View className="dash-cell">
            <Text className="dash-cell-value">{minutes(data.delivery.avgAcceptMinutes)}</Text>
            <Text className="dash-cell-label">平均接单</Text>
          </View>
          <View className="dash-cell">
            <Text className="dash-cell-value">{minutes(data.delivery.avgDeliverMinutes)}</Text>
            <Text className="dash-cell-label">平均送达</Text>
          </View>
          <View className="dash-cell">
            <Text className="dash-cell-value">{data.delivery.overdueCount}</Text>
            <Text className="dash-cell-label">超时配送单</Text>
          </View>
        </View>
      </View>

      <View className="card">
        <View className="row-between">
          <Text className="dash-title dash-title--flush">库存预警</Text>
          <Text className="muted tiny">{data.stock.warningCount} 项</Text>
        </View>
        {data.stock.warnings.length ? (
          data.stock.warnings.map((item) => (
            <View className="dash-warning" key={item.skuId}>
              <View className="grow col">
                <Text className="small">{item.title}</Text>
                <Text className="muted tiny">{item.code}</Text>
              </View>
              <Text className="dash-warning-value">
                {item.available} / {item.safetyStock}
              </Text>
            </View>
          ))
        ) : (
          <Text className="muted tiny dash-empty">库存充足</Text>
        )}
        <View
          className="dash-link"
          onClick={() => Taro.navigateTo({ url: '/pages/store-console/stock?warning=1' })}
        >
          <Text className="small">查看全部库存 ›</Text>
        </View>
      </View>

      <View className="card">
        <Text className="dash-title">今日退款</Text>
        <View className="dash-grid">
          <View className="dash-cell">
            <Text className="dash-cell-value">{data.today.refundOrders}</Text>
            <Text className="dash-cell-label">退款单数</Text>
          </View>
          <View className="dash-cell">
            <Text className="dash-cell-value">{money(data.today.refundCents)}</Text>
            <Text className="dash-cell-label">退款金额</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
