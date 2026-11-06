import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { api, ApiError, formatDate } from '../api/client';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  Empty,
  PageHeader,
  Stat,
  Tag,
  type Column,
} from '../components/ui';

interface ClaimRow {
  id: string;
  status: string;
  createdAt: string;
  usedAt: string | null;
  expiresAt: string;
  customer: { id: string; nickname: string | null; phone: string | null };
}

interface ClaimsResult {
  coupon: { id: string; name: string; total: number; claimed: number };
  items: ClaimRow[];
}

const STATUS_LABEL: Record<string, string> = {
  UNUSED: '未使用',
  USED: '已使用',
  EXPIRED: '已过期',
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '加载失败';
}

export default function CouponClaims() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ClaimsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!id) return;
      setLoading(true);
      try {
        const result = await api<ClaimsResult>(`/admin/coupons/${id}/claims`);
        if (alive) setData(result);
      } catch (err) {
        if (!alive) return;
        setNotFound(true);
        toast(errorText(err), 'error');
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [id]);

  const columns: Column<ClaimRow>[] = [
    {
      key: 'customer',
      title: '客户',
      render: (row) => (
        <div>
          <div>{row.customer.nickname ?? '山野顾客'}</div>
          <div className="small muted">{row.customer.phone ?? '—'}</div>
        </div>
      ),
    },
    {
      key: 'status',
      title: '状态',
      render: (row) => (
        <Tag tone={row.status === 'USED' ? 'brand' : row.status === 'EXPIRED' ? 'muted' : 'ok'}>
          {STATUS_LABEL[row.status] ?? row.status}
        </Tag>
      ),
    },
    {
      key: 'createdAt',
      title: '领取时间',
      render: (row) => <span className="small mono">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'usedAt',
      title: '使用时间',
      render: (row) => <span className="small mono">{formatDate(row.usedAt)}</span>,
    },
    {
      key: 'expiresAt',
      title: '有效期至',
      render: (row) => <span className="small mono">{formatDate(row.expiresAt)}</span>,
    },
  ];

  if (!loading && (notFound || !data)) {
    return (
      <>
        <PageHeader title="发放记录" />
        <Card>
          <Empty text="优惠券不存在或已被删除" />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`发放记录${data ? ` · ${data.coupon.name}` : ''}`}
        desc="查看每张券的领取人、状态与使用时间"
        actions={
          <Button variant="ghost" onClick={() => navigate('/coupons')}>
            返回优惠券
          </Button>
        }
      />

      {data && (
        <div className="grid grid-3">
          <Stat label="发放总量" value={data.coupon.total} />
          <Stat label="已领取" value={data.coupon.claimed} tone="brand" />
          <Stat label="剩余可领" value={Math.max(data.coupon.total - data.coupon.claimed, 0)} tone="ok" />
        </div>
      )}

      <Card title="领取明细">
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          loading={loading}
          empty="还没有领取记录"
        />
      </Card>
    </>
  );
}
