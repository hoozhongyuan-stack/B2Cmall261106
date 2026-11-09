import { Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useState } from 'react';

import { api, showError } from '../../api/client';
import { Loading } from '../../components/common';
import { money } from '../../utils/format';

import './index.css';

interface StoreInfo {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  address: string;
  region: string;
  status: string;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  notice: string | null;
  temporarilyClosedUntil: string | null;
  temporaryClosureNote: string | null;
}

interface Summary {
  store: StoreInfo;
  todo: {
    pendingPickup: number;
    pendingDelivery: number;
    delivering: number;
    stockWarnings: number;
  };
  today: { paidOrders: number; paidCents: number };
}

interface Context {
  hasStore: boolean;
  store: StoreInfo | null;
}

export default function Page() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const ctx = await api<Context>('/store-console/context');
      if (!ctx.hasStore) {
        setDenied(true);
        return;
      }
      setSummary(await api<Summary>('/store-console/summary'));
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => {
    void load();
  });

  if (loading && !summary) return <Loading />;

  if (denied || !summary) {
    return (
      <View className="page">
        <View className="card">
          <Text className="section-title">未关联门店</Text>
          <Text className="muted small">
            当前账号还不是门店负责人。请联系总部在「门店管理」中关联你的会员账号。
          </Text>
        </View>
      </View>
    );
  }

  const { todo, today, store } = summary;
  const closedUntil = store.temporarilyClosedUntil
    ? new Date(store.temporarilyClosedUntil)
    : null;
  const closureActive = Boolean(closedUntil && closedUntil.getTime() > Date.now());

  return (
    <View className="page page--flush">
      {closureActive && (
        <View className="console-closed" onClick={() => Taro.navigateTo({ url: '/pages/store-console/settings' })}>
          <Text className="console-closed-title">临时打烊中</Text>
          <Text className="console-closed-meta">
            预计 {closedUntil!.toLocaleString('zh-CN', { hour12: false })} 恢复
            {store.temporaryClosureNote ? ` · ${store.temporaryClosureNote}` : ''}
          </Text>
        </View>
      )}

      <View className="console-hero">
        <Text className="console-store">{store.name}</Text>
        <Text className="console-meta">
          {store.region} · {store.code}
        </Text>
        <View className="console-hero-stats">
          <View className="console-hero-stat">
            <Text className="console-hero-value">{today.paidOrders}</Text>
            <Text className="console-hero-label">今日支付订单</Text>
          </View>
          <View className="console-hero-stat">
            <Text className="console-hero-value">{money(today.paidCents)}</Text>
            <Text className="console-hero-label">今日实付</Text>
          </View>
        </View>
      </View>

      <View className="console-body">
        <View className="console-todos">
          <View
            className="console-todo"
            onClick={() => Taro.navigateTo({ url: '/pages/store-console/verify' })}
          >
            <Text className="console-todo-value">{todo.pendingPickup}</Text>
            <Text className="console-todo-label">待核销</Text>
          </View>
          <View
            className="console-todo"
            onClick={() => Taro.navigateTo({ url: '/pages/store-console/deliveries?tab=PENDING' })}
          >
            <Text className="console-todo-value">{todo.pendingDelivery}</Text>
            <Text className="console-todo-label">待接单</Text>
          </View>
          <View
            className="console-todo"
            onClick={() =>
              Taro.navigateTo({ url: '/pages/store-console/deliveries?tab=ACCEPTED' })
            }
          >
            <Text className="console-todo-value">{todo.delivering}</Text>
            <Text className="console-todo-label">配送中</Text>
          </View>
          <View
            className="console-todo"
            onClick={() => Taro.navigateTo({ url: '/pages/store-console/stock?warning=1' })}
          >
            <Text className="console-todo-value">{todo.stockWarnings}</Text>
            <Text className="console-todo-label">库存预警</Text>
          </View>
        </View>

        <View
          className="console-primary"
          onClick={() => Taro.navigateTo({ url: '/pages/store-console/verify?focus=1' })}
        >
          <Text className="console-primary-icon">⌗</Text>
          <Text className="console-primary-text">扫码核销</Text>
        </View>

        <View className="list">
          <View
            className="list-item"
            onClick={() => Taro.navigateTo({ url: '/pages/store-console/deliveries' })}
          >
            <Text className="grow small">同城配送</Text>
            <Text className="muted tiny">
              待接单 {todo.pendingDelivery} · 配送中 {todo.delivering} ›
            </Text>
          </View>
          <View
            className="list-item"
            onClick={() => Taro.navigateTo({ url: '/pages/store-console/dashboard' })}
          >
            <Text className="grow small">经营看板</Text>
            <Text className="muted tiny">今日经营 · 时效 · 预警 ›</Text>
          </View>
          <View
            className="list-item"
            onClick={() => Taro.navigateTo({ url: '/pages/store-console/stock' })}
          >
            <Text className="grow small">门店库存</Text>
            <Text className="muted tiny">
              {todo.stockWarnings ? `${todo.stockWarnings} 项预警 ›` : '全部正常 ›'}
            </Text>
          </View>
          <View
            className="list-item"
            onClick={() => Taro.navigateTo({ url: '/pages/store-console/settings' })}
          >
            <Text className="grow small">营业设置</Text>
            <Text className="muted tiny">营业时间 · 公告 ›</Text>
          </View>
          <View className="list-item" onClick={() => void Taro.navigateBack()}>
            <Text className="grow small">返回个人中心</Text>
            <Text className="muted tiny">›</Text>
          </View>
        </View>

        {store.notice ? (
          <View className="card">
            <Text className="small">门店公告</Text>
            <Text className="muted small console-notice">{store.notice}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
