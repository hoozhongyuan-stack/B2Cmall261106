import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError, formatDate, money } from '../api/client';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  Pagination,
  Toolbar,
  type Column,
} from '../components/ui';

interface CustomerRow {
  id: string;
  nickname: string | null;
  phone: string | null;
  levelName: string | null;
  points: number;
  totalSpentCents: number;
  orderCount: number;
  paidCents: number;
  refundedCents: number;
  netCents: number;
  lastOrderAt: string | null;
  createdAt: string;
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '加载失败';
}

export default function Customers() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [items, setItems] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const result = await api<{ items: CustomerRow[]; total: number }>('/admin/customers', {
          query: { keyword: appliedKeyword, page, pageSize: PAGE_SIZE },
        });
        if (alive) {
          setItems(result.items);
          setTotal(result.total);
        }
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
  }, [appliedKeyword, page]);

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    setAppliedKeyword(keyword.trim());
    setPage(1);
  }

  const columns: Column<CustomerRow>[] = [
    {
      key: 'nickname',
      title: '客户',
      render: (row) => (
        <div>
          <div>{row.nickname ?? '山野顾客'}</div>
          <div className="small muted">{row.phone ?? '—'}</div>
        </div>
      ),
    },
    {
      key: 'levelName',
      title: '等级',
      render: (row) => <span>{row.levelName ?? '普通会员'}</span>,
    },
    {
      key: 'points',
      title: '积分',
      align: 'right',
      render: (row) => <span className="mono">{row.points}</span>,
    },
    {
      key: 'totalSpentCents',
      title: '累计消费',
      align: 'right',
      render: (row) => <span className="money">{money(row.totalSpentCents)}</span>,
    },
    {
      key: 'orderCount',
      title: '订单数',
      align: 'right',
      render: (row) => <span className="mono">{row.orderCount}</span>,
    },
    {
      key: 'paidCents',
      title: '实付',
      align: 'right',
      render: (row) => <span className="mono">{money(row.paidCents)}</span>,
    },
    {
      key: 'refundedCents',
      title: '退款',
      align: 'right',
      render: (row) => <span className="mono">{money(row.refundedCents)}</span>,
    },
    {
      key: 'netCents',
      title: '净消费',
      align: 'right',
      render: (row) => <span className="money">{money(row.netCents)}</span>,
    },
    {
      key: 'lastOrderAt',
      title: '最近下单',
      render: (row) => <span className="small mono">{formatDate(row.lastOrderAt)}</span>,
    },
    {
      key: 'createdAt',
      title: '注册时间',
      render: (row) => <span className="small mono">{formatDate(row.createdAt)}</span>,
    },
  ];

  return (
    <>
      <PageHeader title="客户列表" desc="查看客户等级、积分与消费统计，点击行进入客户详情" />

      <Card>
        <form onSubmit={handleSearch}>
          <Toolbar>
            <input
              className="input"
              style={{ width: 280 }}
              placeholder="搜索昵称 / 手机号 / openid"
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
          rows={items}
          loading={loading}
          empty="暂无客户"
          onRowClick={(row) => navigate(`/customers/${row.id}`)}
        />
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
      </Card>
    </>
  );
}
