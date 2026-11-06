import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';

import { api } from '../../api/client';
import { Loading } from '../../components/common';
import { useRequest } from '../../hooks/useRequest';
import { money } from '../../utils/format';

import './index.css';

interface Profile {
  nickname: string | null;
  points: number;
  totalSpentCents: number;
  level: { name: string; discountRate: number; thresholdCents: number } | null;
  nextLevel: { name: string; thresholdCents: number; remainCents: number } | null;
  coupons: { unused: number; used: number; expired: number };
}

function discountText(rate: number): string {
  if (rate >= 1) return '无折扣';
  return `${(rate * 10).toFixed(1).replace(/\.0$/, '')} 折`;
}

export default function Page() {
  const { data } = useRequest(() => api<Profile>('/member/profile'));

  if (!data) return <Loading />;

  const currentThreshold = data.level?.thresholdCents ?? 0;
  const nextThreshold = data.nextLevel?.thresholdCents ?? 0;
  const span = nextThreshold - currentThreshold;
  const gained = data.totalSpentCents - currentThreshold;
  const percent = data.nextLevel && span > 0 ? Math.min(Math.max((gained / span) * 100, 0), 100) : 100;

  return (
    <View className="page page--flush">
      <View className="hero member-hero">
        <Text className="member-name">{data.level?.name ?? '普通会员'}</Text>
        <Text className="member-discount">
          专属折扣 {discountText(data.level?.discountRate ?? 1)}
        </Text>
        <View className="member-progress">
          <View className="member-progress-bar">
            <View className="member-progress-fill" style={{ width: `${percent}%` }} />
          </View>
          <View className="row-between member-progress-meta">
            <Text className="muted tiny">
              累计消费 {money(data.totalSpentCents)}
              {data.nextLevel ? ` / ${money(nextThreshold)}` : ''}
            </Text>
            <Text className="muted tiny">{Math.round(percent)}%</Text>
          </View>
        </View>
        <Text className="member-next">
          {data.nextLevel
            ? `再消费 ${money(data.nextLevel.remainCents)} 升级为 ${data.nextLevel.name}`
            : '已是最高等级，感谢一路同行'}
        </Text>
      </View>

      <View className="member-body">
        <View className="card">
          <View className="stat-row">
            <View
              className="stat"
              onClick={() => Taro.navigateTo({ url: '/pages/points/index' })}
            >
              <Text className="stat-value">{data.points}</Text>
              <Text className="stat-label">积分</Text>
            </View>
            <View
              className="stat"
              onClick={() => Taro.navigateTo({ url: '/pages/coupon/index?tab=mine' })}
            >
              <Text className="stat-value">{data.coupons.unused}</Text>
              <Text className="stat-label">可用券</Text>
            </View>
            <View
              className="stat"
              onClick={() => Taro.navigateTo({ url: '/pages/coupon/index?tab=mine' })}
            >
              <Text className="stat-value">{data.coupons.used + data.coupons.expired}</Text>
              <Text className="stat-label">历史券</Text>
            </View>
          </View>
        </View>

        <View className="list">
          <View
            className="list-item"
            onClick={() => Taro.navigateTo({ url: '/pages/coupon/index' })}
          >
            <Text className="grow small">领券中心</Text>
            <Text className="muted tiny">先领券再下单 ›</Text>
          </View>
          <View
            className="list-item"
            onClick={() => Taro.navigateTo({ url: '/pages/points/index' })}
          >
            <Text className="grow small">积分明细</Text>
            <Text className="muted tiny">{data.points} 分 ›</Text>
          </View>
          <View
            className="list-item"
            onClick={() => Taro.navigateTo({ url: '/pages/coupon/index?tab=mine' })}
          >
            <Text className="grow small">我的优惠券</Text>
            <Text className="muted tiny">未使用 {data.coupons.unused} ›</Text>
          </View>
        </View>

        <Text className="muted tiny member-note">
          会员等级按累计消费计算，退款会同步扣减累计消费与积分
        </Text>
      </View>
    </View>
  );
}
