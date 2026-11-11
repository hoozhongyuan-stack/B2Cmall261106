import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';

import { api, showError } from '../../api/client';
import { Empty, PageState } from '../../components/common';
import { useRequest } from '../../hooks/useRequest';
import { formatDate, money } from '../../utils/format';

import './index.css';

interface CardPlan {
  id: string;
  name: string;
  priceCents: number;
  durationDays: number;
  discountRate: number;
  pointsRate: number;
  freeShipping: boolean;
}

interface MemberCard {
  id: string;
  planName: string;
  discountRate: number;
  pointsRate: number;
  freeShipping: boolean;
  expireAt: string;
}

interface RechargePlan {
  id: string;
  amountCents: number;
  bonusCents: number;
}

interface Ledger {
  id: string;
  deltaCents: number;
  balanceAfter: number;
  type: string;
  remark: string | null;
  createdAt: string;
}

interface Wallet {
  balanceCents: number;
  totalRechargedCents: number;
  totalConsumedCents: number;
  plans: RechargePlan[];
  ledger: Ledger[];
}

interface Membership {
  card: MemberCard | null;
  balanceCents: number;
}

const LEDGER_LABEL: Record<string, string> = {
  RECHARGE: '充值',
  CARD_PURCHASE: '购买会员卡',
  BALANCE_PAY: '余额支付',
  REFUND: '退款退回',
  ADMIN_ADJUST: '后台调整',
  ROLLBACK: '支付回滚',
};

function discountText(rate: number): string {
  if (rate >= 1) return '无折扣';
  return `${(rate * 10).toFixed(1).replace(/\.0$/, '')} 折`;
}

export default function Page() {
  const [version, setVersion] = useState(0);
  const { data, loading } = useRequest(async () => {
    const [membership, plans, wallet] = await Promise.all([
      api<Membership>('/member-cards/mine'),
      api<{ items: CardPlan[] }>('/member-cards/plans'),
      api<Wallet>('/stored-value'),
    ]);
    return { membership, plans: plans.items, wallet };
  }, [version]);

  const reload = () => setVersion((value) => value + 1);

  const purchase = async (plan: CardPlan) => {
    const modal = await Taro.showModal({
      title: `购买${plan.name}`,
      content: `将从储值余额扣除 ${money(plan.priceCents)}，权益立即生效。`,
    });
    if (!modal.confirm) return;
    try {
      await api('/member-cards/purchase', {
        method: 'POST',
        body: { planId: plan.id },
      });
      await Taro.showToast({ title: '会员卡已生效', icon: 'success' });
      reload();
    } catch (err) {
      showError(err);
    }
  };

  const recharge = async (plan: RechargePlan) => {
    const total = plan.amountCents + plan.bonusCents;
    const modal = await Taro.showModal({
      title: '储值充值',
      content: `充值 ${money(plan.amountCents)}${
        plan.bonusCents ? `，赠送 ${money(plan.bonusCents)}` : ''
      }，到账 ${money(total)}。`,
    });
    if (!modal.confirm) return;
    try {
      await api('/stored-value/recharge', {
        method: 'POST',
        body: { planId: plan.id },
      });
      await Taro.showToast({ title: '充值成功', icon: 'success' });
      reload();
    } catch (err) {
      showError(err);
    }
  };

  if (!data) return <PageState loading={loading} />;

  return (
    <View className="page">
      <View className="card mc-balance">
        <Text className="muted small">储值余额</Text>
        <Text className="mc-balance-value">{money(data.wallet.balanceCents)}</Text>
        <Text className="muted tiny">
          累计充值 {money(data.wallet.totalRechargedCents)} · 累计消费{' '}
          {money(data.wallet.totalConsumedCents)}
        </Text>
      </View>

      <View className="card">
        <Text className="section-title mc-title">我的会员卡</Text>
        {data.membership.card ? (
          <View>
            <View className="row-between">
              <Text className="mc-card-name">{data.membership.card.planName}</Text>
              <Text className="tag tag--brand">生效中</Text>
            </View>
            <Text className="muted small">
              会员折扣 {discountText(data.membership.card.discountRate)} · 积分 ×
              {data.membership.card.pointsRate}
              {data.membership.card.freeShipping ? ' · 全场包邮' : ''}
            </Text>
            <Text className="muted tiny mc-expire">
              有效期至 {formatDate(data.membership.card.expireAt)}
            </Text>
          </View>
        ) : (
          <Text className="muted small">暂未开通，购买后折扣与积分权益立即生效</Text>
        )}
      </View>

      <View className="card">
        <Text className="section-title mc-title">购买会员卡</Text>
        <Text className="muted tiny mc-hint">使用储值余额购买；与等级折扣取最优，不叠加</Text>
        {data.plans.map((plan) => (
          <View key={plan.id} className="mc-plan">
            <View className="grow col">
              <Text className="small">{plan.name}</Text>
              <Text className="muted tiny">
                {plan.durationDays} 天 · {discountText(plan.discountRate)} · 积分 ×{plan.pointsRate}
                {plan.freeShipping ? ' · 包邮' : ''}
              </Text>
            </View>
            <View className="col mc-plan-right">
              <Text className="price small">{money(plan.priceCents)}</Text>
              <View className="btn btn--primary btn--sm" onClick={() => void purchase(plan)}>
                购买
              </View>
            </View>
          </View>
        ))}
        {!data.plans.length && <Empty compact text="暂无可购买的会员卡" />}
      </View>

      <View className="card">
        <Text className="section-title mc-title">储值充值</Text>
        <View className="mc-recharge-grid">
          {data.wallet.plans.map((plan) => (
            <View key={plan.id} className="mc-recharge" onClick={() => void recharge(plan)}>
              <Text className="mc-recharge-amount">{money(plan.amountCents)}</Text>
              <Text className="muted tiny">
                {plan.bonusCents ? `赠 ${money(plan.bonusCents)}` : '无赠送'}
              </Text>
            </View>
          ))}
        </View>
        {!data.wallet.plans.length && <Empty compact text="暂无充值套餐" />}
        <Text className="muted tiny mc-hint">本地测试渠道充值即时到账；正式环境将接入微信支付</Text>
      </View>

      <View className="card">
        <Text className="section-title mc-title">资金明细</Text>
        {data.wallet.ledger.map((item) => (
          <View key={item.id} className="row-between mc-ledger">
            <View className="col">
              <Text className="small">{LEDGER_LABEL[item.type] ?? item.type}</Text>
              <Text className="muted tiny">
                {formatDate(item.createdAt, true)}
                {item.remark ? ` · ${item.remark}` : ''}
              </Text>
            </View>
            <View className="col mc-ledger-right">
              <Text className={`small${item.deltaCents < 0 ? ' muted' : ''}`}>
                {item.deltaCents > 0 ? '+' : ''}
                {money(item.deltaCents)}
              </Text>
              <Text className="muted tiny">余额 {money(item.balanceAfter)}</Text>
            </View>
          </View>
        ))}
        {!data.wallet.ledger.length && <Empty compact text="暂无资金流水" />}
      </View>
    </View>
  );
}
