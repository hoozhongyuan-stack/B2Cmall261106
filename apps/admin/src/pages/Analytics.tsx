import { useEffect, useState } from 'react';

import { api, ApiError, money } from '../api/client';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  Stat,
  type Column,
} from '../components/ui';

interface Overview {
  range: { days: number; since: string };
  overview: {
    paidOrders: number;
    gmvCents: number;
    memberDiscountCents: number;
    fullReductionCents: number;
    avgOrderCents: number;
  };
  activity: {
    fullReductionOrders: number;
    fullReductionCents: number;
    seckillItems: number;
    seckillQuantity: number;
    seckillSalesCents: number;
  };
  member: {
    ordersWithDiscount: number;
    gmvCents: number;
    cardPurchases: number;
    rechargeCents: number;
  };
  repurchase: { buyers: number; repeatBuyers: number; repeatRate: number };
  topProducts: Array<{ title: string; quantity: number; salesCents: number }>;
}

interface TopProduct {
  id?: string;
  title: string;
  quantity: number;
  salesCents: number;
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '加载失败';
}

export default function Analytics() {
  const [days, setDays] = useState('30');
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(range = days) {
    setLoading(true);
    try {
      setData(await api<Overview>('/admin/analytics/overview', { query: { days: range } }));
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const productColumns: Column<TopProduct>[] = [
    { key: 'title', title: '商品', render: (row) => <span>{row.title}</span> },
    { key: 'quantity', title: '销量', align: 'right', render: (row) => <span>{row.quantity}</span> },
    {
      key: 'sales',
      title: '销售额',
      align: 'right',
      render: (row) => <span className="money">{money(row.salesCents)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="经营看板"
        desc="活动效果、会员贡献、复购与商品排行（按支付时间统计）"
        actions={
          <div className="row" style={{ gap: 8 }}>
            <select
              className="input"
              style={{ width: 140 }}
              value={days}
              onChange={(e) => {
                setDays(e.target.value);
                void load(e.target.value);
              }}
            >
              <option value="7">近 7 天</option>
              <option value="30">近 30 天</option>
              <option value="90">近 90 天</option>
            </select>
            <Button variant="plain" size="sm" loading={loading} onClick={() => void load()}>
              刷新
            </Button>
          </div>
        }
      />

      <div className="grid grid-4">
        <Stat label="支付订单" value={data?.overview.paidOrders ?? '—'} hint="已支付且未关闭" />
        <Stat label="成交额" value={data ? money(data.overview.gmvCents) : '—'} tone="brand" />
        <Stat label="客单价" value={data ? money(data.overview.avgOrderCents) : '—'} />
        <Stat
          label="复购率"
          value={data ? `${data.repurchase.repeatRate}%` : '—'}
          hint={data ? `${data.repurchase.repeatBuyers}/${data.repurchase.buyers} 人复购` : undefined}
        />
      </div>

      <div className="grid grid-3">
        <Card title="活动效果">
          <div className="small" style={{ display: 'grid', gap: 8 }}>
            <div className="row-between">
              <span className="muted">满减订单</span>
              <span>{data?.activity.fullReductionOrders ?? 0} 单</span>
            </div>
            <div className="row-between">
              <span className="muted">满减让利</span>
              <span>{money(data?.activity.fullReductionCents ?? 0)}</span>
            </div>
            <div className="row-between">
              <span className="muted">秒杀件数</span>
              <span>{data?.activity.seckillQuantity ?? 0} 件</span>
            </div>
            <div className="row-between">
              <span className="muted">秒杀销售额</span>
              <span>{money(data?.activity.seckillSalesCents ?? 0)}</span>
            </div>
          </div>
        </Card>

        <Card title="会员贡献">
          <div className="small" style={{ display: 'grid', gap: 8 }}>
            <div className="row-between">
              <span className="muted">会员折扣订单</span>
              <span>{data?.member.ordersWithDiscount ?? 0} 单</span>
            </div>
            <div className="row-between">
              <span className="muted">会员订单成交额</span>
              <span>{money(data?.member.gmvCents ?? 0)}</span>
            </div>
            <div className="row-between">
              <span className="muted">新购会员卡</span>
              <span>{data?.member.cardPurchases ?? 0} 张</span>
            </div>
            <div className="row-between">
              <span className="muted">储值充值</span>
              <span>{money(data?.member.rechargeCents ?? 0)}</span>
            </div>
          </div>
        </Card>

        <Card title="优惠与复购">
          <div className="small" style={{ display: 'grid', gap: 8 }}>
            <div className="row-between">
              <span className="muted">会员折扣金额</span>
              <span>{money(data?.overview.memberDiscountCents ?? 0)}</span>
            </div>
            <div className="row-between">
              <span className="muted">满减金额</span>
              <span>{money(data?.overview.fullReductionCents ?? 0)}</span>
            </div>
            <div className="row-between">
              <span className="muted">购买用户</span>
              <span>{data?.repurchase.buyers ?? 0} 人</span>
            </div>
            <div className="row-between">
              <span className="muted">复购用户</span>
              <span>{data?.repurchase.repeatBuyers ?? 0} 人</span>
            </div>
          </div>
        </Card>
      </div>

      <Card title="商品销量排行 TOP 10">
        <DataTable
          columns={productColumns}
          rows={(data?.topProducts ?? []).map(
            (item, index): TopProduct => ({ ...item, id: `${item.title}-${index}` }),
          )}
          loading={loading}
          empty="暂无成交数据"
        />
      </Card>
    </>
  );
}
