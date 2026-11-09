import { Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useState } from 'react';

import { api, showError } from '../../api/client';
import { Loading } from '../../components/common';
import { money } from '../../utils/format';

import './index.css';

interface Profile {
  nickname: string | null;
  avatarKey: string | null;
  points: number;
  totalSpentCents: number;
  level: { name: string; discountRate: number; thresholdCents: number } | null;
  nextLevel: { name: string; thresholdCents: number; remainCents: number } | null;
  coupons: { unused: number; used: number; expired: number };
}

interface ShopInfo {
  shopName: string;
  intro: string;
  servicePhone?: string;
}

interface StoreContext {
  hasStore: boolean;
  store: { id: string; name: string; code: string } | null;
}

const ORDER_ENTRIES = [
  { label: '全部', status: '', icon: '≡' },
  { label: '待付款', status: 'PENDING_PAYMENT', icon: '¥' },
  { label: '待发货', status: 'PAID', icon: '包' },
  { label: '待收货', status: 'SHIPPED', icon: '车' },
  { label: '待评价', status: 'COMPLETED', icon: '★' },
];

export default function Page() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [storeCtx, setStoreCtx] = useState<StoreContext | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [nextProfile, nextShop] = await Promise.all([
        api<Profile>('/member/profile'),
        api<ShopInfo>('/shop'),
      ]);
      setProfile(nextProfile);
      setShop(nextShop);
      api<StoreContext>('/store-console/context')
        .then(setStoreCtx)
        .catch(() => setStoreCtx({ hasStore: false, store: null }));
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => {
    void load();
  });

  const goOrders = (status: string) => {
    void Taro.navigateTo({
      url: `/pages/orders/index${status ? `?status=${status}` : ''}`,
    });
  };

  const callService = async () => {
    if (!shop?.servicePhone) {
      await Taro.showToast({ title: '暂未配置客服电话', icon: 'none' });
      return;
    }
    await Taro.makePhoneCall({ phoneNumber: shop.servicePhone });
  };

  if (loading && !profile) return <Loading />;

  return (
    <View className="page page--flush">
      <View className="hero mine-hero">
        <View className="row">
          <View className="mine-avatar">
            <Text>{(profile?.nickname ?? '山').slice(0, 1)}</Text>
          </View>
          <View className="grow col">
            <Text className="mine-nickname">{profile?.nickname ?? '山野顾客'}</Text>
            <View className="row mine-level-row">
              <Text className="mine-level">{profile?.level?.name ?? '普通会员'}</Text>
              <Text className="muted tiny">
                累计消费 {money(profile?.totalSpentCents ?? 0)}
              </Text>
            </View>
          </View>
          <View
            className="mine-member-link"
            onClick={() => Taro.navigateTo({ url: '/pages/member/index' })}
          >
            会员中心 ›
          </View>
        </View>

        <View className="stat-row mine-stats">
          <View className="stat mine-stat" onClick={() => Taro.navigateTo({ url: '/pages/points/index' })}>
            <Text className="stat-value">{profile?.points ?? 0}</Text>
            <Text className="stat-label">积分</Text>
          </View>
          <View
            className="stat mine-stat"
            onClick={() => Taro.navigateTo({ url: '/pages/coupon/index?tab=mine' })}
          >
            <Text className="stat-value">{profile?.coupons.unused ?? 0}</Text>
            <Text className="stat-label">优惠券</Text>
          </View>
          <View
            className="stat mine-stat"
            onClick={() => Taro.navigateTo({ url: '/pages/address/list/index' })}
          >
            <Text className="stat-value">{profile?.level?.discountRate === 1 ? '无' : '有'}</Text>
            <Text className="stat-label">会员折扣</Text>
          </View>
        </View>
      </View>

      <View className="mine-body">
        <View className="card">
          <View className="row-between mine-card-head">
            <Text className="section-title mine-flush">我的订单</Text>
            <Text className="muted tiny" onClick={() => goOrders('')}>
              全部订单 ›
            </Text>
          </View>
          <View className="mine-orders">
            {ORDER_ENTRIES.map((entry) => (
              <View
                key={entry.label}
                className="mine-order-item"
                onClick={() => goOrders(entry.status)}
              >
                <Text className="mine-order-icon">{entry.icon}</Text>
                <Text className="tiny">{entry.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {storeCtx?.hasStore && (
          <View
            className="card mine-store-entry"
            onClick={() => Taro.navigateTo({ url: '/pages/store-console/index' })}
          >
            <View className="row-between">
              <View className="col">
                <Text className="mine-store-title">门店中心</Text>
                <Text className="muted tiny">{storeCtx.store?.name ?? ''} · 核销与配送</Text>
              </View>
              <Text className="mine-store-arrow">›</Text>
            </View>
          </View>
        )}

        <View className="list mine-menu">
          <View
            className="list-item"
            onClick={() => Taro.navigateTo({ url: '/pages/coupon/index?tab=mine' })}
          >
            <Text className="grow small">我的优惠券</Text>
            <Text className="muted tiny">{profile?.coupons.unused ?? 0} 张可用 ›</Text>
          </View>
          <View
            className="list-item"
            onClick={() => Taro.navigateTo({ url: '/pages/points/index' })}
          >
            <Text className="grow small">积分明细</Text>
            <Text className="muted tiny">{profile?.points ?? 0} 分 ›</Text>
          </View>
          <View
            className="list-item"
            onClick={() => Taro.navigateTo({ url: '/pages/review/mine/index' })}
          >
            <Text className="grow small">我的评价</Text>
            <Text className="muted tiny">›</Text>
          </View>
          <View
            className="list-item"
            onClick={() => Taro.navigateTo({ url: '/pages/after-sale/list/index' })}
          >
            <Text className="grow small">售后记录</Text>
            <Text className="muted tiny">›</Text>
          </View>
          <View
            className="list-item"
            onClick={() => Taro.navigateTo({ url: '/pages/address/list/index' })}
          >
            <Text className="grow small">收货地址</Text>
            <Text className="muted tiny">›</Text>
          </View>
          <View className="list-item" onClick={callService}>
            <Text className="grow small">联系客服</Text>
            <Text className="muted tiny">{shop?.servicePhone ?? '未配置'} ›</Text>
          </View>
        </View>

        <Text className="muted tiny mine-shop">
          {shop?.shopName ?? '山野'}
          {shop?.intro ? ` · ${shop.intro}` : ''}
        </Text>
      </View>
    </View>
  );
}
