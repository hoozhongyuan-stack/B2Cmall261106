import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ORDER_STATUS_LABEL, can, type OrderStatus } from '@shanye/shared/src/orderState';

import { api, ApiError, formatDate, money } from '../api/client';
import { hasRole } from '../auth';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  Field,
  KeyValue,
  Modal,
  PageHeader,
  Tag,
  type Column,
} from '../components/ui';

interface AddressSnapshot {
  receiver?: string;
  phone?: string;
  region?: string;
  detail?: string;
}

interface OrderItemRow {
  id: string;
  title: string;
  specText: string;
  imageKey: string | null;
  priceCents: number;
  quantity: number;
  subtotalCents: number;
  paidCents: number;
  refundedCents: number;
}

interface PaymentRow {
  id: string;
  provider: string;
  outTradeNo: string;
  transactionId: string | null;
  amountCents: number;
  status: string;
  paidAt: string | null;
  createdAt: string;
}

interface ShipmentRow {
  id: string;
  expressCode: string;
  expressName: string;
  trackingNo: string;
  shippedAt: string;
}

interface OrderDetailData {
  id: string;
  orderNo: string;
  status: string;
  goodsCents: number;
  memberDiscountCents: number;
  couponCents: number;
  freightCents: number;
  payableCents: number;
  refundedCents: number;
  addressSnapshot: AddressSnapshot;
  remark: string | null;
  adminRemark: string | null;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  user: { id: string; nickname: string | null; phone: string | null };
  items: OrderItemRow[];
  payments: PaymentRow[];
  shipment: ShipmentRow | null;
}

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: '待支付',
  SUCCESS: '支付成功',
  FAILED: '支付失败',
  REFUNDED: '已退款',
};

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
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<OrderDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [shipOpen, setShipOpen] = useState(false);
  const [shipForm, setShipForm] = useState({ expressCode: '', expressName: '', trackingNo: '' });
  const [shipping, setShipping] = useState(false);
  const [remark, setRemark] = useState('');
  const [remarkSaving, setRemarkSaving] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const result = await api<OrderDetailData>(`/admin/orders/${id}`);
      setData(result);
      setRemark(result.adminRemark ?? '');
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

  async function handleShip() {
    if (!id) return;
    if (!shipForm.expressCode.trim() || !shipForm.expressName.trim() || !shipForm.trackingNo.trim()) {
      toast('请填写完整物流信息', 'error');
      return;
    }
    setShipping(true);
    try {
      await api(`/admin/orders/${id}/ship`, {
        method: 'POST',
        body: {
          expressCode: shipForm.expressCode.trim(),
          expressName: shipForm.expressName.trim(),
          trackingNo: shipForm.trackingNo.trim(),
        },
      });
      toast('已发货');
      setShipOpen(false);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setShipping(false);
    }
  }

  async function saveRemark() {
    if (!id) return;
    setRemarkSaving(true);
    try {
      await api(`/admin/orders/${id}/remark`, { method: 'POST', body: { remark } });
      toast('已保存');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setRemarkSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="订单详情" />
        <div className="table-loading">加载中…</div>
      </>
    );
  }

  if (notFound || !data) {
    return (
      <>
        <PageHeader title="订单详情" />
        <Card>
          <div className="empty">订单不存在或已被删除</div>
        </Card>
      </>
    );
  }

  const status = data.status as OrderStatus;
  const canShip = can(status, 'ship') && hasRole('SUPER', 'WMS');
  const canRemark = hasRole('SUPER', 'CS');

  const itemColumns: Column<OrderItemRow>[] = [
    {
      key: 'title',
      title: '商品',
      render: (row) => (
        <div>
          <div>{row.title}</div>
          <div className="small muted">{row.specText}</div>
        </div>
      ),
    },
    {
      key: 'priceCents',
      title: '单价',
      align: 'right',
      render: (row) => <span className="money">{money(row.priceCents)}</span>,
    },
    {
      key: 'quantity',
      title: '数量',
      align: 'right',
      render: (row) => <span className="mono">×{row.quantity}</span>,
    },
    {
      key: 'subtotalCents',
      title: '小计',
      align: 'right',
      render: (row) => <span className="money">{money(row.subtotalCents)}</span>,
    },
    {
      key: 'paidCents',
      title: '行实付',
      align: 'right',
      render: (row) => <span className="money">{money(row.paidCents)}</span>,
    },
    {
      key: 'refundedCents',
      title: '已退款',
      align: 'right',
      render: (row) => <span className="mono">{money(row.refundedCents)}</span>,
    },
  ];

  const paymentColumns: Column<PaymentRow>[] = [
    { key: 'provider', title: '渠道', render: (row) => <span>{row.provider}</span> },
    { key: 'outTradeNo', title: '商户单号', render: (row) => <span className="mono small">{row.outTradeNo}</span> },
    {
      key: 'transactionId',
      title: '渠道流水号',
      render: (row) => <span className="mono small">{row.transactionId ?? '—'}</span>,
    },
    {
      key: 'amountCents',
      title: '金额',
      align: 'right',
      render: (row) => <span className="money">{money(row.amountCents)}</span>,
    },
    {
      key: 'status',
      title: '状态',
      render: (row) => (
        <Tag tone={row.status === 'SUCCESS' ? 'ok' : row.status === 'FAILED' ? 'danger' : 'muted'}>
          {PAYMENT_STATUS_LABEL[row.status] ?? row.status}
        </Tag>
      ),
    },
    {
      key: 'paidAt',
      title: '支付时间',
      render: (row) => <span className="small mono">{formatDate(row.paidAt ?? row.createdAt)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title={`订单 ${data.orderNo}`}
        desc={`下单于 ${formatDate(data.createdAt)}`}
        actions={
          <div className="row">
            <Button variant="ghost" onClick={() => navigate('/orders')}>
              返回列表
            </Button>
            {canShip && <Button onClick={() => setShipOpen(true)}>发货</Button>}
          </div>
        }
      />

      <Card>
        <KeyValue
          items={[
            { label: '订单号', value: <span className="mono">{data.orderNo}</span> },
            { label: '订单状态', value: <Tag tone={statusTone(data.status)}>{ORDER_STATUS_LABEL[status]}</Tag> },
            {
              label: '客户',
              value: `${data.user.nickname ?? '山野顾客'}${data.user.phone ? ` · ${data.user.phone}` : ''}`,
            },
            { label: '支付时间', value: formatDate(data.paidAt) },
            { label: '发货时间', value: formatDate(data.shippedAt) },
            { label: '完成时间', value: formatDate(data.completedAt) },
            { label: '关闭时间', value: formatDate(data.closedAt) },
            { label: '买家备注', value: data.remark || '—' },
            { label: '商家备注', value: data.adminRemark || '—' },
          ]}
        />
      </Card>

      <div className="grid grid-2">
        <Card title="金额明细">
          <KeyValue
            items={[
              { label: '商品金额', value: money(data.goodsCents) },
              { label: '会员优惠', value: `-${money(data.memberDiscountCents)}` },
              { label: '优惠券', value: `-${money(data.couponCents)}` },
              { label: '运费', value: money(data.freightCents) },
              { label: '应付金额', value: <strong className="money">{money(data.payableCents)}</strong> },
              { label: '已退款', value: money(data.refundedCents) },
            ]}
          />
        </Card>
        <Card title="收货信息">
          <KeyValue
            items={[
              { label: '收货人', value: data.addressSnapshot?.receiver ?? '—' },
              { label: '联系电话', value: data.addressSnapshot?.phone ?? '—' },
              { label: '所在地区', value: data.addressSnapshot?.region ?? '—' },
              { label: '详细地址', value: data.addressSnapshot?.detail ?? '—' },
            ]}
          />
        </Card>
      </div>

      <Card title="商品明细">
        <DataTable columns={itemColumns} rows={data.items} empty="订单没有商品" />
      </Card>

      <Card title="支付记录">
        <DataTable columns={paymentColumns} rows={data.payments} empty="暂无支付记录" />
      </Card>

      <Card title="物流信息">
        {data.shipment ? (
          <KeyValue
            items={[
              { label: '快递公司', value: data.shipment.expressName },
              { label: '快递编码', value: data.shipment.expressCode },
              { label: '运单号', value: <span className="mono">{data.shipment.trackingNo}</span> },
              { label: '发货时间', value: formatDate(data.shipment.shippedAt) },
            ]}
          />
        ) : (
          <div className="empty">尚未发货</div>
        )}
      </Card>

      {canRemark && (
        <Card title="商家备注">
          <Field label="备注内容" hint="仅后台可见，用于客服交接">
            <textarea
              className="textarea"
              value={remark}
              placeholder="例如：客户要求工作日送达"
              onChange={(e) => setRemark(e.target.value)}
            />
          </Field>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="ghost" loading={remarkSaving} onClick={() => void saveRemark()}>
              保存备注
            </Button>
          </div>
        </Card>
      )}

      <Modal
        open={shipOpen}
        title="订单发货"
        onClose={() => setShipOpen(false)}
        footer={
          <>
            <Button variant="plain" onClick={() => setShipOpen(false)}>
              取消
            </Button>
            <Button loading={shipping} onClick={() => void handleShip()}>
              确认发货
            </Button>
          </>
        }
      >
        <Field label="快递编码" hint="例如：SF / YTO">
          <input
            className="input"
            value={shipForm.expressCode}
            onChange={(e) => setShipForm((prev) => ({ ...prev, expressCode: e.target.value }))}
          />
        </Field>
        <Field label="快递公司">
          <input
            className="input"
            value={shipForm.expressName}
            onChange={(e) => setShipForm((prev) => ({ ...prev, expressName: e.target.value }))}
          />
        </Field>
        <Field label="运单号">
          <input
            className="input"
            value={shipForm.trackingNo}
            onChange={(e) => setShipForm((prev) => ({ ...prev, trackingNo: e.target.value }))}
          />
        </Field>
      </Modal>
    </>
  );
}
