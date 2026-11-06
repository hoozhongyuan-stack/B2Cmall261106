import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ORDER_STATUS_LABEL, type OrderStatus } from '@shanye/shared/src/orderState';

import { api, ApiError, formatDate, money } from '../api/client';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  Pagination,
  Tabs,
  Tag,
  Toolbar,
  type Column,
} from '../components/ui';

interface AddressSnapshot {
  receiver?: string;
  phone?: string;
  region?: string;
  detail?: string;
}

interface OrderRow {
  id: string;
  orderNo: string;
  status: string;
  payableCents: number;
  createdAt: string;
  paidAt: string | null;
  customer: { nickname: string | null; phone: string | null };
  itemCount: number;
  firstItemTitle: string;
  address: AddressSnapshot;
}

interface OrderListResult {
  tabs: { status: string; count: number }[];
  items: OrderRow[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUS_ORDER: OrderStatus[] = [
  'PENDING_PAYMENT',
  'PAID',
  'SHIPPED',
  'COMPLETED',
  'REFUNDING',
  'REFUNDED',
  'CLOSED',
];

function statusTone(status: string): 'muted' | 'brand' | 'ok' | 'warn' | 'danger' {
  switch (status) {
    case 'PAID':
      return 'warn';
    case 'SHIPPED':
      return 'brand';
    case 'COMPLETED':
      return 'ok';
    case 'REFUNDING':
    case 'REFUNDED':
      return 'danger';
    default:
      return 'muted';
  }
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '加载失败';
}

export default function Orders() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [data, setData] = useState<OrderListResult>({
    tabs: [],
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const result = await api<OrderListResult>('/admin/orders', {
          query: { status, keyword: appliedKeyword, page, pageSize: PAGE_SIZE },
        });
        if (alive) setData(result);
      } catch (err) {
        if (alive) toast(errorText(err), 'error');
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [status, appliedKeyword, page]);

  function changeStatus(next: string) {
    setStatus(next);
    setPage(1);
    setSearchParams(next ? { status: next } : {});
  }

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    setAppliedKeyword(keyword.trim());
    setPage(1);
  }

  const countMap = new Map(data.tabs.map((tab) => [tab.status, tab.count]));
  const total = data.tabs.reduce((sum, tab) => sum + tab.count, 0);

  const tabs = [
    { value: '', label: '全部', count: total },
    ...STATUS_ORDER.map((item) => ({
      value: item,
      label: ORDER_STATUS_LABEL[item],
      count: countMap.get(item) ?? 0,
    })),
  ];

  const columns: Column<OrderRow>[] = [
    {
      key: 'orderNo',
      title: '订单号',
      render: (row) => <span className="mono small">{row.orderNo}</span>,
    },
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
      key: 'items',
      title: '商品',
      render: (row) => (
        <div>
          <div>{row.firstItemTitle || '—'}</div>
          <div className="small muted">共 {row.itemCount} 件</div>
        </div>
      ),
    },
    {
      key: 'payableCents',
      title: '应付金额',
      align: 'right',
      render: (row) => <span className="money">{money(row.payableCents)}</span>,
    },
    {
      key: 'status',
      title: '状态',
      render: (row) => (
        <Tag tone={statusTone(row.status)}>
          {ORDER_STATUS_LABEL[row.status as OrderStatus] ?? row.status}
        </Tag>
      ),
    },
    {
      key: 'address',
      title: '收货信息',
      render: (row) => (
        <div className="small">
          <div>
            {row.address?.receiver ?? '—'} {row.address?.phone ?? ''}
          </div>
          <div className="muted">
            {row.address?.region ?? ''} {row.address?.detail ?? ''}
          </div>
        </div>
      ),
    },
    {
      key: 'createdAt',
      title: '下单时间',
      render: (row) => <span className="small mono">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'paidAt',
      title: '支付时间',
      render: (row) => <span className="small mono">{formatDate(row.paidAt)}</span>,
    },
  ];

  return (
    <>
      <PageHeader title="所有订单" desc="按状态筛选与关键词搜索，点击行查看订单详情" />

      <Card>
        <Tabs items={tabs} value={status} onChange={changeStatus} />

        <form onSubmit={handleSearch}>
          <Toolbar>
            <input
              className="input"
              style={{ width: 260 }}
              placeholder="搜索订单号 / 客户昵称"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Button type="submit" variant="ghost">
              搜索
            </Button>
            <Button
              type="button"
              variant="plain"
              onClick={() => {
                setKeyword('');
                setAppliedKeyword('');
              }}
            >
              重置
            </Button>
          </Toolbar>
        </form>

        <DataTable
          columns={columns}
          rows={data.items}
          loading={loading}
          empty="当前筛选下暂无订单"
          onRowClick={(row) => navigate(`/orders/${row.id}`)}
        />
        <Pagination
          page={page}
          total={data.total ?? data.items.length}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      </Card>
    </>
  );
}
