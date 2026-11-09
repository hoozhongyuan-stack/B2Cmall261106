import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AFTER_SALE_STATUS_LABEL,
  type AfterSaleStatus,
} from '@shanye/shared/src/orderState';

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

interface AfterSaleItem {
  id: string;
  afterSaleNo: string;
  type: string;
  status: string;
  refundCents: number;
  createdAt: string;
  orderNo: string | null;
  item: { title: string; specText: string; priceCents: number; quantity: number } | null;
}

interface AfterSaleResult {
  tabs: { status: string; count: number }[];
  items: AfterSaleItem[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUS_ORDER: AfterSaleStatus[] = [
  'APPLIED',
  'WAIT_BUYER_SHIP',
  'WAIT_SELLER_RECEIVE',
  'REFUNDING',
  'COMPLETED',
  'REJECTED',
];

const TYPE_LABEL: Record<string, string> = {
  REFUND_ONLY: '仅退款',
  RETURN_REFUND: '退货退款',
};

function statusTone(status: string): 'muted' | 'brand' | 'ok' | 'warn' | 'danger' {
  switch (status) {
    case 'APPLIED':
    case 'WAIT_SELLER_RECEIVE':
      return 'warn';
    case 'WAIT_BUYER_SHIP':
    case 'REFUNDING':
      return 'brand';
    case 'COMPLETED':
      return 'ok';
    case 'REJECTED':
      return 'danger';
    default:
      return 'muted';
  }
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '加载失败';
}

export default function AfterSales() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [data, setData] = useState<AfterSaleResult>({
    tabs: [],
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const PAGE_SIZE = 20;

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const result = await api<AfterSaleResult>('/admin/after-sales', {
          query: {
            status,
            page,
            pageSize: PAGE_SIZE,
            keyword: appliedKeyword || undefined,
            type: typeFilter || undefined,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
          },
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
  }, [status, page, appliedKeyword, typeFilter, startDate, endDate]);

  const countMap = new Map(data.tabs.map((tab) => [tab.status, tab.count]));
  const total = data.tabs.reduce((sum, tab) => sum + tab.count, 0);
  const tabs = [
    { value: '', label: '全部', count: total },
    ...STATUS_ORDER.map((item) => ({
      value: item,
      label: AFTER_SALE_STATUS_LABEL[item],
      count: countMap.get(item) ?? 0,
    })),
  ];

  const columns: Column<AfterSaleItem>[] = [
    {
      key: 'afterSaleNo',
      title: '售后单号',
      render: (row) => <span className="mono small">{row.afterSaleNo}</span>,
    },
    {
      key: 'orderNo',
      title: '订单号',
      render: (row) => <span className="mono small">{row.orderNo ?? '—'}</span>,
    },
    {
      key: 'item',
      title: '商品',
      render: (row) =>
        row.item ? (
          <div>
            <div>{row.item.title}</div>
            <div className="small muted">
              {row.item.specText} · ×{row.item.quantity}
            </div>
          </div>
        ) : (
          '—'
        ),
    },
    {
      key: 'type',
      title: '类型',
      render: (row) => <span>{TYPE_LABEL[row.type] ?? row.type}</span>,
    },
    {
      key: 'refundCents',
      title: '退款金额',
      align: 'right',
      render: (row) => <span className="money">{money(row.refundCents)}</span>,
    },
    {
      key: 'status',
      title: '状态',
      render: (row) => (
        <Tag tone={statusTone(row.status)}>
          {AFTER_SALE_STATUS_LABEL[row.status as AfterSaleStatus] ?? row.status}
        </Tag>
      ),
    },
    {
      key: 'createdAt',
      title: '申请时间',
      render: (row) => <span className="small mono">{formatDate(row.createdAt)}</span>,
    },
  ];

  return (
    <>
      <PageHeader title="售后管理" desc="审核仅退款 / 退货退款，确认收货后自动发起退款" />

      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedKeyword(keyword.trim());
            setPage(1);
          }}
        >
          <Toolbar>
            <input
              className="input"
              style={{ width: 260 }}
              aria-label="搜索售后单号或订单号"
              placeholder="搜索售后单号 / 订单号 / 商品…"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <select
              className="select"
              aria-label="按售后类型筛选"
              value={typeFilter}
              onChange={(event) => {
                setTypeFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部类型</option>
              <option value="REFUND_ONLY">仅退款</option>
              <option value="RETURN_REFUND">退货退款</option>
            </select>
            <input
              className="input"
              type="date"
              style={{ width: 148 }}
              aria-label="售后开始日期"
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                setPage(1);
              }}
            />
            <span className="muted small">至</span>
            <input
              className="input"
              type="date"
              style={{ width: 148 }}
              aria-label="售后结束日期"
              value={endDate}
              onChange={(event) => {
                setEndDate(event.target.value);
                setPage(1);
              }}
            />
            <div className="toolbar-actions">
              <Button
                type="button"
                variant="plain"
                onClick={() => {
                  setKeyword('');
                  setAppliedKeyword('');
                  setTypeFilter('');
                  setStartDate('');
                  setEndDate('');
                  setPage(1);
                }}
              >
                重置
              </Button>
              <Button type="submit" variant="ghost">
                搜索
              </Button>
            </div>
          </Toolbar>
        </form>
        <Tabs
          items={tabs}
          value={status}
          onChange={(next) => {
            setStatus(next);
            setPage(1);
          }}
        />
        <DataTable
          columns={columns}
          rows={data.items}
          loading={loading}
          empty="当前筛选下暂无售后单"
          onRowClick={(row) => navigate(`/after-sales/${row.id}`)}
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
