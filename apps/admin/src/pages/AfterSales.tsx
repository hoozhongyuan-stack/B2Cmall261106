import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AFTER_SALE_STATUS_LABEL,
  type AfterSaleStatus,
} from '@shanye/shared/src/orderState';

import { api, ApiError, formatDate, money } from '../api/client';
import { hasRole } from '../auth';
import { confirmAction } from '../components/confirm';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  Field,
  Modal,
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
  const [moderateTarget, setModerateTarget] = useState<AfterSaleItem | null>(null);
  const [moderateAction, setModerateAction] = useState<
    'approve_only_refund' | 'approve_return' | 'reject'
  >('approve_only_refund');
  const [rejectReason, setRejectReason] = useState('');
  const [working, setWorking] = useState(false);
  const PAGE_SIZE = 20;

  async function reload() {
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
      setData(result);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [status, page, appliedKeyword, typeFilter, startDate, endDate]);

  async function submitModerate() {
    if (!moderateTarget) return;
    if (moderateAction === 'reject' && !rejectReason.trim()) {
      toast('拒绝时必须填写理由', 'error');
      return;
    }
    if (moderateAction !== 'reject') {
      const label = moderateAction === 'approve_only_refund' ? '同意仅退款' : '同意退货';
      const confirmed = await confirmAction(
        `确定${label}吗？将立即向买家退款 ${money(moderateTarget.refundCents)}，操作不可撤销。`,
      );
      if (!confirmed) return;
    }
    setWorking(true);
    try {
      await api(`/admin/after-sales/${moderateTarget.id}/moderate`, {
        method: 'POST',
        body: {
          action: moderateAction,
          ...(moderateAction === 'reject' ? { rejectReason: rejectReason.trim() } : {}),
        },
      });
      toast('已处理');
      setModerateTarget(null);
      setRejectReason('');
      await reload();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setWorking(false);
    }
  }

  async function receive(row: AfterSaleItem) {
    const confirmed = await confirmAction(
      `确认已收到退货并退款 ${money(row.refundCents)} 吗？操作不可撤销。`,
    );
    if (!confirmed) return;
    setWorking(true);
    try {
      await api(`/admin/after-sales/${row.id}/receive`, { method: 'POST' });
      toast('已确认收货并退款');
      await reload();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setWorking(false);
    }
  }

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
    {
      key: 'actions',
      title: '操作',
      width: '190px',
      render: (row) => {
        const canModerate = row.status === 'APPLIED' && hasRole('SUPER', 'CS');
        const canReceive = row.status === 'WAIT_SELLER_RECEIVE' && hasRole('SUPER', 'WMS');
        return (
          <div
            className="row"
            style={{ justifyContent: 'flex-end', gap: 6 }}
            onClick={(event) => event.stopPropagation()}
          >
            <Button size="sm" variant="ghost" onClick={() => navigate(`/after-sales/${row.id}`)}>
              查看
            </Button>
            {canModerate && (
              <Button
                size="sm"
                onClick={() => {
                  setModerateAction('approve_only_refund');
                  setRejectReason('');
                  setModerateTarget(row);
                }}
              >
                审核
              </Button>
            )}
            {canReceive && (
              <Button size="sm" loading={working} onClick={() => void receive(row)}>
                确认收货
              </Button>
            )}
          </div>
        );
      },
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

      <Modal
        open={Boolean(moderateTarget)}
        title={`售后审核 ${moderateTarget?.afterSaleNo ?? ''}`}
        onClose={() => setModerateTarget(null)}
        footer={
          <>
            <Button variant="plain" onClick={() => setModerateTarget(null)}>
              取消
            </Button>
            <Button
              variant={moderateAction === 'reject' ? 'danger' : 'primary'}
              loading={working}
              onClick={() => void submitModerate()}
            >
              {moderateAction === 'reject' ? '确认拒绝' : '确认处理'}
            </Button>
          </>
        }
      >
        <p className="small muted" style={{ marginTop: 0 }}>
          退款金额 {money(moderateTarget?.refundCents ?? 0)}，请选择处理方式。
        </p>
        <Field label="处理方式">
          <select
            className="select"
            value={moderateAction}
            onChange={(event) =>
              setModerateAction(
                event.target.value as 'approve_only_refund' | 'approve_return' | 'reject',
              )
            }
          >
            <option value="approve_only_refund">同意仅退款（立即退款）</option>
            <option value="approve_return">同意退货（等待买家寄回）</option>
            <option value="reject">拒绝售后</option>
          </select>
        </Field>
        {moderateAction === 'reject' && (
          <Field label="拒绝理由" hint="必填，将展示给买家">
            <textarea
              className="textarea"
              value={rejectReason}
              placeholder="请说明拒绝原因"
              onChange={(event) => setRejectReason(event.target.value)}
            />
          </Field>
        )}
      </Modal>
    </>
  );
}
