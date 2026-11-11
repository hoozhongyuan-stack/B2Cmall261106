import { Button, Text, View } from '@tarojs/components';
import Taro, { useShareAppMessage } from '@tarojs/taro';
import { useEffect, useState } from 'react';

import { api, showError } from '../../api/client';
import { Loading, PageState } from '../../components/common';
import { formatDate } from '../../utils/format';

import './index.css';

interface PointRecord {
  id: string;
  delta: number;
  source: string;
  reason: string;
  balanceAfter: number;
  createdAt: string;
}

interface PointsConfig {
  yuanPerPoint: number;
  signInPoints: number;
  signInStreakDays: number;
  signInStreakBonusType: 'POINTS' | 'COUPON';
  signInStreakBonusPoints: number;
  sharePoints: number;
  shareDailyLimit: number;
}

interface Overview {
  balance: number;
  config: PointsConfig;
  signIn: {
    enabled: boolean;
    signedToday: boolean;
    streak: number;
    nextStreak: number;
    todayPoints: number;
    bonusPoints: number;
    nextBonusIn: number | null;
  };
  share: {
    enabled: boolean;
    points: number;
    limit: number;
    todayCount: number;
    remaining: number;
  };
}

interface Ledger {
  balance: number;
  items: PointRecord[];
}

const SOURCE_LABEL: Record<string, string> = {
  ORDER_PAID: '订单支付',
  REFUND: '退款扣回',
  ADMIN: '后台调整',
  SIGN_IN: '每日签到',
  SHARE: '分享奖励',
};

export default function Page() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');

  async function load() {
    try {
      const [nextOverview, nextLedger] = await Promise.all([
        api<Overview>('/member/points/overview'),
        api<Ledger>('/member/points'),
      ]);
      setOverview(nextOverview);
      setLedger(nextLedger);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function signIn() {
    if (working || overview?.signIn.signedToday) return;
    setWorking('signIn');
    try {
      const result = await api<{ points: number; bonusPoints: number; streak: number; couponName: string | null }>(
        '/member/points/sign-in',
        { method: 'POST' },
      );
      await Taro.showToast({
        title: result.couponName
          ? `签到成功，获得${result.couponName}`
          : `签到成功 +${result.points} 积分`,
        icon: 'none',
      });
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setWorking('');
    }
  }

  async function claimShare() {
    if (working) return;
    setWorking('share');
    try {
      const result = await api<{ awarded: boolean; reason?: string; points: number }>(
        '/member/points/share',
        { method: 'POST' },
      );
      await Taro.showToast({
        title: result.awarded ? `分享奖励 +${result.points} 积分` : result.reason ?? '今日已达上限',
        icon: 'none',
      });
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setWorking('');
    }
  }

  useShareAppMessage(() => {
    void api('/member/points/share', { method: 'POST' })
      .then(() => load())
      .catch(() => undefined);
    return { title: '山野好物 · 顺时而食', path: '/pages/home/index' };
  });

  if (loading && !overview) return <Loading />;

  const signInState = overview?.signIn;
  const shareState = overview?.share;
  const bonusText =
    signInState && signInState.nextBonusIn !== null
      ? signInState.nextBonusIn === 0
        ? '今天签到即可获得连续奖励'
        : `再连续签到 ${signInState.nextBonusIn} 天可获得额外奖励`
      : '';

  return (
    <View className="page">
      <View className="hero points-hero">
        <Text className="points-label">当前积分</Text>
        <Text className="points-balance">{overview?.balance ?? ledger?.balance ?? 0}</Text>
        <Text className="points-note">
          消费每 {overview?.config.yuanPerPoint ?? 1} 元得 1 分 · 积分仅记录，不参与抵扣
        </Text>
      </View>

      {signInState?.enabled && (
        <View className="card points-task">
          <View className="row-between">
            <View className="col grow" style={{ gap: 4 }}>
              <Text className="points-task-title">每日签到</Text>
              <Text className="muted tiny">
                已连续 {signInState.streak} 天 · 今日 +{signInState.todayPoints} 分
                {signInState.bonusPoints > 0 ? `（含奖励 ${signInState.bonusPoints} 分）` : ''}
              </Text>
              {bonusText ? <Text className="muted tiny">{bonusText}</Text> : null}
            </View>
            <Button
              className={`points-task-btn${signInState.signedToday ? ' is-done' : ''}`}
              loading={working === 'signIn'}
              disabled={signInState.signedToday}
              onClick={() => void signIn()}
            >
              {signInState.signedToday ? '今日已签到' : '签到'}
            </Button>
          </View>
        </View>
      )}

      {shareState?.enabled && (
        <View className="card points-task">
          <View className="row-between">
            <View className="col grow" style={{ gap: 4 }}>
              <Text className="points-task-title">分享给好友</Text>
              <Text className="muted tiny">
                每次 +{shareState.points} 分 · 今日已得 {shareState.todayCount}/{shareState.limit} 次
              </Text>
            </View>
            <Button
              className="points-task-btn"
              openType={process.env.TARO_ENV === 'weapp' ? 'share' : undefined}
              loading={working === 'share'}
              disabled={shareState.remaining <= 0}
              onClick={() => {
                if (process.env.TARO_ENV !== 'weapp') void claimShare();
              }}
            >
              {shareState.remaining > 0 ? '立即分享' : '今日已完成'}
            </Button>
          </View>
        </View>
      )}

      <View className="section-title">积分流水</View>
      <PageState
        loading={loading && !ledger}
        empty={!loading && !ledger?.items.length}
        text="暂无积分记录"
      >
        <View className="list">
          {ledger?.items.map((record) => (
            <View key={record.id} className="list-item">
              <View className="grow col">
                <Text className="small">{record.reason}</Text>
                <Text className="muted tiny">
                  {SOURCE_LABEL[record.source] ?? record.source} ·{' '}
                  {formatDate(record.createdAt, true)}
                </Text>
              </View>
              <View className="col points-right">
                <Text className={`points-delta${record.delta >= 0 ? ' points-delta--up' : ''}`}>
                  {record.delta >= 0 ? '+' : ''}
                  {record.delta}
                </Text>
                <Text className="muted tiny">余额 {record.balanceAfter}</Text>
              </View>
            </View>
          ))}
        </View>
      </PageState>
    </View>
  );
}
