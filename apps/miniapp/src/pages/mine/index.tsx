import { Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { tokens } from '@shanye/tokens';
import { useState } from 'react';

import { api, clearConsent, clearToken, showError } from '../../api/client';
import { AppTabBar } from '../../components/AppTabBar';
import { Cell, Loading, SectionHeader } from '../../components/common';
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

  const logout = async () => {
    const confirmed = await Taro.showModal({
      title: '退出登录',
      content: '退出后需要重新同意协议并授权登录。',
      confirmText: '退出登录',
      confirmColor: tokens.color.danger,
    });
    if (!confirmed.confirm) return;
    clearToken();
    clearConsent();
    await Taro.reLaunch({ url: '/pages/home/index' });
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
          <SectionHeader
            className="mine-card-head"
            title="我的订单"
            action="全部订单"
            onAction={() => goOrders('')}
          />
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
          <Cell
            title="我的优惠券"
            value={`${profile?.coupons.unused ?? 0} 张可用`}
            onClick={() => Taro.navigateTo({ url: '/pages/coupon/index?tab=mine' })}
          />
          <Cell
            title="积分明细"
            value={`${profile?.points ?? 0} 分`}
            onClick={() => Taro.navigateTo({ url: '/pages/points/index' })}
          />
          <Cell
            title="我的评价"
            onClick={() => Taro.navigateTo({ url: '/pages/review/mine/index' })}
          />
          <Cell
            title="售后记录"
            onClick={() => Taro.navigateTo({ url: '/pages/after-sale/list/index' })}
          />
          <Cell
            title="收货地址"
            onClick={() => Taro.navigateTo({ url: '/pages/address/list/index' })}
          />
          <Cell title="联系客服" value={shop?.servicePhone ?? '未配置'} onClick={callService} />
          <Cell
            title="关于我们"
            value="品牌与备案信息"
            onClick={() => Taro.navigateTo({ url: '/pages/about/index' })}
          />
        </View>

        <View className="list mine-menu mine-logout">
          <View className="list-item" onClick={() => void logout()}>
            <Text className="grow small mine-logout-text">退出登录</Text>
          </View>
        </View>

        <Text className="muted tiny mine-shop">
          {shop?.shopName ?? '山野'}
          {shop?.intro ? ` · ${shop.intro}` : ''}
        </Text>
      </View>
      <AppTabBar />
    </View>
  );
}
