import { useEffect, useState } from 'react';

import { api, ApiError, formatDate, money } from '../api/client';
import { StoreFilter, useStoreOptions } from '../components/StoreFilter';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  Pagination,
  Tag,
  Toolbar,
  type Column,
} from '../components/ui';

interface PickupItem {
  title: string;
  specText: string;
  quantity: number;
}

interface PendingPickup {
  id: string;
  orderNo: string;
  storeId: string;
  storeName: string;
  storeAddress: string;
  storePhone: string | null;
  pickupCode: string;
  pickupAt: string | null;
  pickupCodeExpiresAt: string | null;
  payableCents: number;
  phone: string | null;
  items: PickupItem[];
}

interface VerifiedPickup {
  id: string;
  orderId: string;
  orderNo: string;
  storeId: string;
  storeName: string;
  method: string;
  verifiedBy: string | null;
  verifiedAt: string;
  note: string | null;
  payableCents: number;
  items: PickupItem[];
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function Pickups() {
  const [tab, setTab] = useState<'pending' | 'verified'>('pending');
  const stores = useStoreOptions();
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<PendingPickup[]>([]);
  const [verified, setVerified] = useState<VerifiedPickup[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);

  async function load() {
    setLoading(true);
    try {
      const result = await api<{ total: number; items: PendingPickup[] | VerifiedPickup[] }>(
        '/admin/pickups',
        {
          query: {
            status: tab,
            storeIds: storeIds.length ? storeIds.join(',') : undefined,
            keyword,
            page,
            pageSize,
          },
        },
      );
      if (tab === 'pending') setPending(result.items as PendingPickup[]);
      else setVerified(result.items as VerifiedPickup[]);
      setTotal(result.total);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [tab, storeIds, page, pageSize]);

  async function verify(input?: string) {
    const value = (input ?? code).trim();
    if (!/^\d{8}$/.test(value)) {
      toast('请输入 8 位核销码', 'error');
      return;
    }
    setVerifying(true);
    try {
      const result = await api<{ alreadyVerified: boolean }>('/admin/pickups/verify', {
        method: 'POST',
        body: { code: value },
      });
      toast(result.alreadyVerified ? '该订单已核销' : '核销成功');
      setCode('');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setVerifying(false);
    }
  }

  const pendingColumns: Column<PendingPickup>[] = [
    {
      key: 'code',
      title: '核销码',
      render: (row) => <span className="mono pickup-code">{row.pickupCode}</span>,
    },
    {
      key: 'store',
      title: '门店',
      render: (row) => (
        <div className="small">
          <div>{row.storeName}</div>
          <div className="muted">{row.storeAddress}</div>
        </div>
      ),
    },
    {
      key: 'items',
      title: '商品',
      render: (row) => (
        <div className="small">
          <div>{row.items[0]?.title ?? '—'}</div>
          <div className="muted">
            共 {row.items.reduce((sum, item) => sum + item.quantity, 0)} 件 ·{' '}
            {money(row.payableCents)}
          </div>
        </div>
      ),
    },
    {
      key: 'pickupAt',
      title: '预约自提',
      render: (row) => (
        <span className="small">{row.pickupAt ? formatDate(row.pickupAt) : '未指定'}</span>
      ),
    },
    {
      key: 'expires',
      title: '过期时间',
      render: (row) => (
        <span className="small muted">
          {row.pickupCodeExpiresAt ? formatDate(row.pickupCodeExpiresAt) : '—'}
        </span>
      ),
    },
    {
      key: 'phone',
      title: '联系电话',
      render: (row) => <span className="small">{row.phone ?? row.storePhone ?? '—'}</span>,
    },
    {
      key: 'actions',
      title: '操作',
      align: 'right',
      render: (row) => (
        <Button size="sm" loading={verifying} onClick={() => void verify(row.pickupCode)}>
          核销
        </Button>
      ),
    },
  ];

  const verifiedColumns: Column<VerifiedPickup>[] = [
    {
      key: 'orderNo',
      title: '订单号',
      render: (row) => <span className="mono small">{row.orderNo}</span>,
    },
    {
      key: 'store',
      title: '门店',
      render: (row) => <span className="small">{row.storeName}</span>,
    },
    {
      key: 'method',
      title: '方式',
      render: (row) => <Tag tone={row.method === 'AUTO' ? 'muted' : 'ok'}>
        {row.method === 'AUTO' ? '超时自动' : '人工核销'}
      </Tag>,
    },
    {
      key: 'verifiedAt',
      title: '核销时间',
      render: (row) => <span className="small">{formatDate(row.verifiedAt)}</span>,
    },
    {
      key: 'operator',
      title: '核销人',
      render: (row) => <span className="small mono">{row.verifiedBy ?? 'SYSTEM'}</span>,
    },
    {
      key: 'amount',
      title: '金额',
      align: 'right',
      render: (row) => <span className="small">{money(row.payableCents)}</span>,
    },
    {
      key: 'note',
      title: '备注',
      render: (row) => <span className="small muted">{row.note ?? '—'}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="自提核销"
        desc="输入或扫描用户核销码完成自提；重复核销会提示已核销，不会重复完成订单"
      />

      <Card>
        <Toolbar>
          <form
            className="row"
            style={{ gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <input
              className="input"
              style={{ width: 200 }}
              placeholder="8 位核销码"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button type="submit" loading={verifying}>
              核销
            </Button>
          </form>
          <select
            className="select"
            value={tab}
            aria-label="核销状态"
            onChange={(e) => {
              setTab(e.target.value as 'pending' | 'verified');
              setPage(1);
            }}
          >
            <option value="pending">待核销</option>
            <option value="verified">核销记录</option>
          </select>
          <StoreFilter
            stores={stores}
            value={storeIds}
            onChange={(ids) => {
              setStoreIds(ids);
              setPage(1);
            }}
          />
          <input
            className="input"
            style={{ width: 220 }}
            placeholder="订单号 / 核销码"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Button variant="ghost" onClick={() => void load()}>
            查询
          </Button>
        </Toolbar>

        {tab === 'pending' ? (
          <DataTable
            columns={pendingColumns}
            rows={pending}
            loading={loading}
            empty="暂无待核销自提订单"
          />
        ) : (
          <DataTable
            columns={verifiedColumns}
            rows={verified}
            loading={loading}
            empty="暂无核销记录"
          />
        )}
        <Pagination
          page={page}
          total={total}
          pageSize={pageSize}
          onChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </Card>
    </>
  );
}
