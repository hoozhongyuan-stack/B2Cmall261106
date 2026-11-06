import { Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useState } from 'react';

import { api, showError } from '../../api/client';
import { Empty, Loading } from '../../components/common';
import { formatDate, money } from '../../utils/format';

import './index.css';

interface ClaimableCoupon {
  id: string;
  name: string;
  type: string;
  thresholdCents: number;
  faceValueCents: number;
  startAt: string;
  endAt: string;
  remaining: number;
  claimedByMe: number;
  perLimit: number;
  canClaim: boolean;
}

interface MineCoupon {
  id: string;
  couponId: string;
  name: string;
  type: string;
  thresholdCents: number;
  faceValueCents: number;
  status: string;
  expiresAt: string;
  usedAt: string | null;
}

const MINE_TABS = [
  { key: 'UNUSED', label: '未使用' },
  { key: 'USED', label: '已使用' },
  { key: 'EXPIRED', label: '已过期' },
];

export default function Page() {
  const router = useRouter();
  const [tab, setTab] = useState(router.params.tab === 'mine' ? 'mine' : 'center');
  const [mineStatus, setMineStatus] = useState('UNUSED');
  const [claimable, setClaimable] = useState<ClaimableCoupon[]>([]);
  const [mine, setMine] = useState<MineCoupon[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = async (nextTab: string, nextStatus: string) => {
    setLoading(true);
    try {
      if (nextTab === 'center') {
        const res = await api<{ items: ClaimableCoupon[] }>('/coupons');
        setClaimable(res.items);
      } else {
        const res = await api<{ counts: { status: string; count: number }[]; items: MineCoupon[] }>(
          '/coupons/mine',
          { query: { status: nextStatus } },
        );
        setMine(res.items);
        setCounts(
          res.counts.reduce<Record<string, number>>((acc, item) => {
            acc[item.status] = item.count;
            return acc;
          }, {}),
        );
      }
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => {
    void load(tab, mineStatus);
  });

  const switchTab = (nextTab: string) => {
    setTab(nextTab);
    void load(nextTab, mineStatus);
  };

  const switchMineStatus = (nextStatus: string) => {
    setMineStatus(nextStatus);
    void load('mine', nextStatus);
  };

  const claim = async (coupon: ClaimableCoupon) => {
    try {
      await api(`/coupons/${coupon.id}/claim`, { method: 'POST' });
      await Taro.showToast({ title: '已领取', icon: 'success' });
      await load('center', mineStatus);
    } catch (err) {
      showError(err);
    }
  };

  return (
    <View className="page">
      <View className="tabs">
        <View
          className={`tab${tab === 'center' ? ' tab--on' : ''}`}
          onClick={() => switchTab('center')}
        >
          领券中心
        </View>
        <View
          className={`tab${tab === 'mine' ? ' tab--on' : ''}`}
          onClick={() => switchTab('mine')}
        >
          我的券
        </View>
      </View>

      {tab === 'mine' && (
        <View className="tabs coupon-sub-tabs">
          {MINE_TABS.map((item) => (
            <View
              key={item.key}
              className={`tab${mineStatus === item.key ? ' tab--on' : ''}`}
              onClick={() => switchMineStatus(item.key)}
            >
              {item.label}
              {counts[item.key] ? ` ${counts[item.key]}` : ''}
            </View>
          ))}
        </View>
      )}

      {loading && <Loading />}

      {!loading && tab === 'center' && !claimable.length && <Empty text="暂无可领取的优惠券" />}
      {!loading && tab === 'mine' && !mine.length && <Empty text="这里还没有优惠券" />}

      {!loading &&
        tab === 'center' &&
        claimable.map((coupon) => (
          <View key={coupon.id} className="card coupon-card">
            <View className="coupon-face">
              <Text className="coupon-value">{money(coupon.faceValueCents)}</Text>
              <Text className="coupon-threshold">
                {coupon.thresholdCents > 0 ? `满 ${money(coupon.thresholdCents)} 可用` : '无门槛'}
              </Text>
            </View>
            <View className="grow col coupon-body">
              <Text className="small coupon-name">{coupon.name}</Text>
              <Text className="muted tiny">
                {formatDate(coupon.startAt)} 至 {formatDate(coupon.endAt)} · 余 {coupon.remaining} 张
              </Text>
              <Text className="muted tiny">
                每人限领 {coupon.perLimit} 张，已领 {coupon.claimedByMe} 张
              </Text>
            </View>
            <View
              className={`btn btn--sm${coupon.canClaim ? ' btn--primary' : ''} coupon-claim`}
              onClick={() => coupon.canClaim && claim(coupon)}
            >
              {coupon.canClaim ? '领取' : '已领完'}
            </View>
          </View>
        ))}

      {!loading &&
        tab === 'mine' &&
        mine.map((coupon) => (
          <View
            key={coupon.id}
            className={`card coupon-card${coupon.status === 'UNUSED' ? '' : ' coupon-card--off'}`}
          >
            <View className="coupon-face">
              <Text className="coupon-value">{money(coupon.faceValueCents)}</Text>
              <Text className="coupon-threshold">
                {coupon.thresholdCents > 0 ? `满 ${money(coupon.thresholdCents)} 可用` : '无门槛'}
              </Text>
            </View>
            <View className="grow col coupon-body">
              <Text className="small coupon-name">{coupon.name}</Text>
              <Text className="muted tiny">
                {coupon.status === 'USED' && coupon.usedAt
                  ? `${formatDate(coupon.usedAt)} 已使用`
                  : `${formatDate(coupon.expiresAt)} 到期`}
              </Text>
            </View>
            <Text className="tag coupon-status">
              {coupon.status === 'UNUSED' ? '未使用' : coupon.status === 'USED' ? '已使用' : '已过期'}
            </Text>
          </View>
        ))}
    </View>
  );
}
