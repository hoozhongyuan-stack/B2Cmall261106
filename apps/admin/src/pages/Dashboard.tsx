import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError, money } from '../api/client';
import { toast } from '../components/toast';
import { Card, DataTable, Empty, Money, PageHeader, Stat, type Column } from '../components/ui';

interface DashboardData {
  today: {
    paidOrderCount: number;
    paidAmountCents: number;
    refundedCents: number;
    newCustomerCount: number;
  };
  yesterday: {
    paidOrderCount: number;
    paidAmountCents: number;
    refundedCents: number;
    newCustomerCount: number;
  };
  pending: {
    toShipCount: number;
    afterSaleCount: number;
    pendingReviewCount: number;
  };
  trend: { date: string; orderCount: number; paidAmountCents: number }[];
  topProducts: { productId: string; title: string; quantity: number; amountCents: number }[];
}

const TREND_BAR_BASE = 140;
const TEST_PRODUCT_TITLE = /^(E2E|契约)/i;

function deltaHint(today: number, yesterday: number): string {
  if (yesterday === 0) return today === 0 ? '与昨日持平' : '昨日为 0';
  const diff = Math.round(((today - yesterday) / yesterday) * 100);
  if (diff === 0) return '与昨日持平';
  return `较昨日 ${diff > 0 ? '+' : ''}${diff}%`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [includeTestData, setIncludeTestData] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const result = await api<DashboardData>('/admin/dashboard');
        if (alive) setData(result);
      } catch (err) {
        if (!alive) return;
        setFailed(true);
        toast(err instanceof ApiError ? err.message : '概览加载失败', 'error');
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <>
        <PageHeader title="数据概览" desc="今日经营表现与待处理事项" />
        <div className="table-loading">加载中…</div>
      </>
    );
  }

  if (failed || !data) {
    return (
      <>
        <PageHeader title="数据概览" desc="今日经营表现与待处理事项" />
        <Card>
          <Empty text="暂时无法获取概览数据" />
        </Card>
      </>
    );
  }

  const maxAmount = Math.max(...data.trend.map((item) => item.paidAmountCents), 1);
  const hasTrend = data.trend.some((item) => item.paidAmountCents > 0 || item.orderCount > 0);
  const topProducts = includeTestData
    ? data.topProducts
    : data.topProducts.filter((item) => !TEST_PRODUCT_TITLE.test(item.title));
  type TopProduct = DashboardData['topProducts'][number] & { id?: string };
  const topColumns: Column<TopProduct>[] = [
    {
      key: 'title',
      title: '商品',
      render: (row) => <span>{row.title}</span>,
    },
    {
      key: 'quantity',
      title: '销量',
      align: 'right',
      render: (row) => <span className="mono">{row.quantity} 件</span>,
    },
    {
      key: 'amountCents',
      title: '销售额',
      align: 'right',
      render: (row) => <Money cents={row.amountCents} />,
    },
  ];

  return (
    <>
      <PageHeader title="数据概览" desc="今日经营表现与待处理事项" />

      <div className="grid grid-4">
        <Stat
          label="今日支付订单"
          value={data.today.paidOrderCount}
          hint={deltaHint(data.today.paidOrderCount, data.yesterday.paidOrderCount)}
        />
        <Stat
          label="今日支付金额"
          value={money(data.today.paidAmountCents)}
          hint={deltaHint(data.today.paidAmountCents, data.yesterday.paidAmountCents)}
          tone="brand"
        />
        <Stat
          label="今日退款金额"
          value={money(data.today.refundedCents)}
          hint={deltaHint(data.today.refundedCents, data.yesterday.refundedCents)}
          tone="warn"
        />
        <Stat
          label="今日新增客户"
          value={data.today.newCustomerCount}
          hint={deltaHint(data.today.newCustomerCount, data.yesterday.newCustomerCount)}
          tone="ok"
        />
      </div>

      <div className="grid grid-3" style={{ marginTop: 18 }}>
        <div
          style={{ cursor: 'pointer' }}
          onClick={() => navigate('/orders?status=PAID')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') navigate('/orders?status=PAID');
          }}
        >
          <Card title="待发货">
            <Stat label="待处理订单" value={data.pending.toShipCount} hint="点击进入发货列表" tone="warn" />
          </Card>
        </div>
        <div
          style={{ cursor: 'pointer' }}
          onClick={() => navigate('/after-sales')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') navigate('/after-sales');
          }}
        >
          <Card title="待处理售后">
            <Stat label="待审核 / 待收货" value={data.pending.afterSaleCount} hint="点击进入售后列表" tone="warn" />
          </Card>
        </div>
        <div
          style={{ cursor: 'pointer' }}
          onClick={() => navigate('/reviews')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') navigate('/reviews');
          }}
        >
          <Card title="待审核评价">
            <Stat label="待审评价" value={data.pending.pendingReviewCount} hint="点击进入评价列表" tone="warn" />
          </Card>
        </div>
      </div>

      <Card title="近 7 日支付趋势" extra={<span className="small muted">按支付金额等比展示</span>}>
        {!hasTrend ? (
          <Empty text="近 7 日暂无支付数据" />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 14,
              height: TREND_BAR_BASE + 96,
              paddingTop: 8,
            }}
          >
            {data.trend.map((item) => {
              const height =
                item.paidAmountCents > 0
                  ? Math.max((item.paidAmountCents / maxAmount) * TREND_BAR_BASE, 4)
                  : 2;
              return (
                <div
                  key={item.date}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
                  title={`${item.date} · ${item.orderCount} 单 · ${money(item.paidAmountCents)}`}
                >
                  <span className="small muted mono">{money(item.paidAmountCents)}</span>
                  <div
                    style={{
                      width: '100%',
                      height,
                      background: item.paidAmountCents > 0 ? 'var(--brand)' : 'var(--surface-2)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  />
                  <span className="small mono">{item.date.slice(5)}</span>
                  <span className="small muted">{item.orderCount} 单</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card
        title="热销商品"
        extra={
          <label className="row small muted" style={{ gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              className="checkbox"
              checked={includeTestData}
              onChange={(event) => setIncludeTestData(event.target.checked)}
            />
            含测试数据
          </label>
        }
      >
        <DataTable
          columns={topColumns}
          rows={topProducts}
          rowKey={(row) => row.productId}
          empty="近 7 日暂无成交（可勾选含测试数据）"
        />
      </Card>
    </>
  );
}
