import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AFTER_SALE_STATUS,
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
  Empty,
  Field,
  KeyValue,
  Modal,
  PageHeader,
  Tag,
} from '../components/ui';

interface AfterSaleItemInfo {
  title: string;
  specText: string;
  priceCents: number;
  quantity: number;
}

interface RefundInfo {
  refundNo: string;
  status: string;
  refundedAt: string | null;
}

interface AfterSaleDetailData {
  id: string;
  afterSaleNo: string;
  type: string;
  reason: string;
  description: string | null;
  evidence: string[];
  refundCents: number;
  status: string;
  rejectReason: string | null;
  buyerTrackingNo: string | null;
  createdAt: string;
  finishedAt: string | null;
  orderNo: string | null;
  item: AfterSaleItemInfo | null;
  refund: RefundInfo | null;
}

const TYPE_LABEL: Record<string, string> = {
  REFUND_ONLY: '仅退款',
  RETURN_REFUND: '退货退款',
};

const REFUND_STATUS_LABEL: Record<string, string> = {
  PENDING: '退款中',
  SUCCESS: '退款成功',
  FAILED: '退款失败',
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
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function AfterSaleDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<AfterSaleDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [working, setWorking] = useState('');

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const result = await api<AfterSaleDetailData>(`/admin/after-sales/${id}`);
      setData(result);
      setRejectReason(result.rejectReason ?? '');
    } catch (err) {
      setNotFound(true);
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function moderate(
    action: 'approve_only_refund' | 'approve_return' | 'reject',
    reason?: string,
  ) {
    if (!id) return;
    if (action === 'reject' && !reason?.trim()) {
      toast('拒绝时必须填写理由', 'error');
      return;
    }
    // 资金操作必须二次确认：点击即退款，不可撤销
    if (action !== 'reject') {
      const label = action === 'approve_only_refund' ? '同意仅退款' : '同意退货';
      const amount = money(data?.refundCents ?? 0);
      if (!(await confirmAction(`确定${label}吗？将立即向买家退款 ${amount}，操作不可撤销。`))) return;
    }
    setWorking(action);
    try {
      await api(`/admin/after-sales/${id}/moderate`, {
        method: 'POST',
        body: { action, ...(reason?.trim() ? { rejectReason: reason.trim() } : {}) },
      });
      toast('已处理');
      setRejectOpen(false);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setWorking('');
    }
  }

  async function receive() {
    if (!id) return;
    if (!(await confirmAction(`确认已收到退货并退款 ${money(data?.refundCents ?? 0)} 吗？操作不可撤销。`))) {
      return;
    }
    setWorking('receive');
    try {
      await api(`/admin/after-sales/${id}/receive`, { method: 'POST' });
      toast('已确认收货并退款');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setWorking('');
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="售后详情" />
        <div className="table-loading">加载中…</div>
      </>
    );
  }

  if (notFound || !data) {
    return (
      <>
        <PageHeader title="售后详情" />
        <Card>
          <Empty text="售后单不存在或已被删除" />
        </Card>
      </>
    );
  }

  const status = data.status as AfterSaleStatus;
  const canModerate = hasRole('SUPER', 'CS');
  const canReceive = hasRole('SUPER', 'WMS');
  const showModerate = status === AFTER_SALE_STATUS.APPLIED && canModerate;
  const showReceive = status === AFTER_SALE_STATUS.WAIT_SELLER_RECEIVE && canReceive;

  return (
    <>
      <PageHeader
        title={`售后 ${data.afterSaleNo}`}
        desc={`关联订单 ${data.orderNo ?? '—'}`}
        actions={
          <div className="row">
            <Button variant="ghost" onClick={() => navigate('/after-sales')}>
              返回列表
            </Button>
            {showModerate && (
              <>
                <Button loading={working === 'approve_only_refund'} onClick={() => void moderate('approve_only_refund')}>
                  同意仅退款
                </Button>
                <Button
                  variant="ghost"
                  loading={working === 'approve_return'}
                  onClick={() => void moderate('approve_return')}
                >
                  同意退货
                </Button>
                <Button variant="danger" onClick={() => setRejectOpen(true)}>
                  拒绝
                </Button>
              </>
            )}
            {showReceive && (
              <Button loading={working === 'receive'} onClick={() => void receive()}>
                确认收货并退款
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <KeyValue
          items={[
            { label: '售后单号', value: <span className="mono">{data.afterSaleNo}</span> },
            {
              label: '售后状态',
              value: <Tag tone={statusTone(data.status)}>{AFTER_SALE_STATUS_LABEL[status]}</Tag>,
            },
            { label: '售后类型', value: TYPE_LABEL[data.type] ?? data.type },
            { label: '退款金额', value: <span className="money">{money(data.refundCents)}</span> },
            { label: '申请时间', value: formatDate(data.createdAt) },
            { label: '完成时间', value: formatDate(data.finishedAt) },
            { label: '买家寄回单号', value: data.buyerTrackingNo || '—' },
            { label: '拒绝理由', value: data.rejectReason || '—' },
          ]}
        />
      </Card>

      <Card title="售后商品">
        {data.item ? (
          <KeyValue
            items={[
              { label: '商品', value: data.item.title },
              { label: '规格', value: data.item.specText },
              { label: '单价', value: money(data.item.priceCents) },
              { label: '数量', value: `×${data.item.quantity}` },
            ]}
          />
        ) : (
          <Empty text="商品信息缺失" />
        )}
      </Card>

      <Card title="问题描述">
        <KeyValue
          items={[
            { label: '售后原因', value: data.reason },
            { label: '补充说明', value: data.description || '—' },
          ]}
        />
        <div style={{ marginTop: 14 }}>
          {data.evidence.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: 10,
              }}
            >
              {data.evidence.map((src, index) => (
                <a key={`${src}-${index}`} href={src} target="_blank" rel="noreferrer">
                  <img
                    src={src}
                    alt={`凭证 ${index + 1}`}
                    style={{
                      width: '100%',
                      height: 110,
                      objectFit: 'cover',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-2)',
                    }}
                  />
                </a>
              ))}
            </div>
          ) : (
            <Empty text="买家未上传凭证" />
          )}
        </div>
      </Card>

      <Card title="退款记录">
        {data.refund ? (
          <KeyValue
            items={[
              { label: '退款单号', value: <span className="mono">{data.refund.refundNo}</span> },
              {
                label: '退款状态',
                value: (
                  <Tag tone={data.refund.status === 'SUCCESS' ? 'ok' : data.refund.status === 'FAILED' ? 'danger' : 'warn'}>
                    {REFUND_STATUS_LABEL[data.refund.status] ?? data.refund.status}
                  </Tag>
                ),
              },
              { label: '退款时间', value: formatDate(data.refund.refundedAt) },
            ]}
          />
        ) : (
          <Empty text="尚未发起退款" />
        )}
      </Card>

      <Modal
        open={rejectOpen}
        title="拒绝售后"
        onClose={() => setRejectOpen(false)}
        footer={
          <>
            <Button variant="plain" onClick={() => setRejectOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              loading={working === 'reject'}
              onClick={() => void moderate('reject', rejectReason)}
            >
              确认拒绝
            </Button>
          </>
        }
      >
        <Field label="拒绝理由" hint="必填，将展示给买家">
          <textarea
            className="textarea"
            value={rejectReason}
            placeholder="请说明拒绝原因"
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </Field>
      </Modal>
    </>
  );
}
