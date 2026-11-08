import { useEffect, useState } from 'react';

import { api, ApiError, formatDate, money } from '../api/client';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  Field,
  Modal,
  PageHeader,
  Tabs,
  Tag,
  Toolbar,
  type Column,
} from '../components/ui';

type DeliveryTab = 'PENDING' | 'ACCEPTED' | 'DELIVERED' | 'OVERDUE' | 'CANCELLED';

interface DeliveryItem {
  title: string;
  specText: string;
  quantity: number;
}

interface DeliveryRow {
  id: string;
  orderId: string;
  orderNo: string;
  orderStatus: string;
  storeId: string;
  storeName: string;
  status: string;
  overdue: boolean;
  courierName: string | null;
  courierPhone: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  remark: string | null;
  createdAt: string;
  receiver: string | null;
  phone: string | null;
  address: string | null;
  payableCents: number;
  items: DeliveryItem[];
}

interface StoreOption {
  id: string;
  name: string;
}

/** 超时口径由服务端统一判定（待接单 15 分钟 / 配送中 60 分钟） */

const STATUS_LABEL: Record<string, string> = {
  PENDING: '待接单',
  ACCEPTED: '配送中',
  DELIVERED: '已送达',
  CANCELLED: '已取消',
};

const STATUS_TONE: Record<string, 'muted' | 'brand' | 'ok' | 'warn' | 'danger'> = {
  PENDING: 'warn',
  ACCEPTED: 'brand',
  DELIVERED: 'ok',
  CANCELLED: 'muted',
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function Deliveries() {
  const [tab, setTab] = useState<DeliveryTab>('PENDING');
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeId, setStoreId] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const [acceptTarget, setAcceptTarget] = useState<DeliveryRow | null>(null);
  const [courierName, setCourierName] = useState('');
  const [courierPhone, setCourierPhone] = useState('');
  const [cancelTarget, setCancelTarget] = useState<DeliveryRow | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  async function load() {
    setLoading(true);
    try {
      const result = await api<{ items: DeliveryRow[] }>('/admin/deliveries', {
        query: { status: tab === 'OVERDUE' ? undefined : tab, storeId, date },
      });
      setRows(tab === 'OVERDUE' ? result.items.filter((item) => item.overdue) : result.items);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api<{ items: StoreOption[] }>('/admin/stores/mine')
      .then((result) => setStores(result.items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
  }, [tab, storeId, date]);

  async function submitAccept() {
    if (!acceptTarget) return;
    setActing(true);
    try {
      await api(`/admin/deliveries/${acceptTarget.id}/accept`, {
        method: 'POST',
        body: {
          courierName: courierName.trim() || undefined,
          courierPhone: courierPhone.trim() || undefined,
        },
      });
      toast('已接单');
      setAcceptTarget(null);
      setCourierName('');
      setCourierPhone('');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setActing(false);
    }
  }

  async function submitDeliver(row: DeliveryRow) {
    if (!window.confirm(`确认订单 ${row.orderNo} 已送达？`)) return;
    setActing(true);
    try {
      await api(`/admin/deliveries/${row.id}/deliver`, { method: 'POST' });
      toast('已送达');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setActing(false);
    }
  }

  async function submitCancel() {
    if (!cancelTarget) return;
    if (!cancelReason.trim()) {
      toast('请填写取消原因', 'error');
      return;
    }
    setActing(true);
    try {
      await api(`/admin/deliveries/${cancelTarget.id}/cancel`, {
        method: 'POST',
        body: { reason: cancelReason.trim() },
      });
      toast('已取消配送');
      setCancelTarget(null);
      setCancelReason('');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setActing(false);
    }
  }

  const columns: Column<DeliveryRow>[] = [
    {
      key: 'orderNo',
      title: '订单号',
      render: (row) => (
        <div className="small">
          <div className="mono">{row.orderNo}</div>
          <div className="muted">{formatDate(row.createdAt)}</div>
        </div>
      ),
    },
    {
      key: 'store',
      title: '门店',
      render: (row) => <span className="small">{row.storeName || '—'}</span>,
    },
    {
      key: 'address',
      title: '收货信息',
      render: (row) => (
        <div className="small">
          <div>
            {row.receiver ?? '—'}
            {row.phone ? ` · ${row.phone}` : ''}
          </div>
          <div className="muted">{row.address ?? '—'}</div>
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
      key: 'status',
      title: '状态',
      render: (row) => (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Tag tone={STATUS_TONE[row.status] ?? 'muted'}>
            {STATUS_LABEL[row.status] ?? row.status}
          </Tag>
          {row.overdue && <Tag tone="danger">超时</Tag>}
        </div>
      ),
    },
    {
      key: 'courier',
      title: '配送员',
      render: (row) => (
        <div className="small">
          <div>{row.courierName ?? '—'}</div>
          <div className="muted">{row.courierPhone ?? ''}</div>
        </div>
      ),
    },
    {
      key: 'times',
      title: '接单 / 送达',
      render: (row) => (
        <div className="small muted">
          <div>接单 {formatDate(row.acceptedAt)}</div>
          <div>送达 {formatDate(row.deliveredAt)}</div>
        </div>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      align: 'right',
      render: (row) => (
        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          {row.status === 'PENDING' && (
            <Button
              size="sm"
              disabled={acting}
              onClick={() => {
                setAcceptTarget(row);
                setCourierName('');
                setCourierPhone('');
              }}
            >
              接单
            </Button>
          )}
          {row.status === 'ACCEPTED' && (
            <Button size="sm" disabled={acting} onClick={() => void submitDeliver(row)}>
              送达
            </Button>
          )}
          {(row.status === 'PENDING' || row.status === 'ACCEPTED') && (
            <Button
              size="sm"
              variant="ghost"
              disabled={acting}
              onClick={() => {
                setCancelTarget(row);
                setCancelReason('');
              }}
            >
              取消
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="同城配送"
        desc="门店接单后订单进入待收货，送达后自动完成；超时单会标记提醒"
      />

      <Card>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'PENDING', label: '待接单' },
            { value: 'ACCEPTED', label: '配送中' },
            { value: 'DELIVERED', label: '已送达' },
            { value: 'OVERDUE', label: '超时' },
            { value: 'CANCELLED', label: '已取消' },
          ]}
        />
        <Toolbar>
          <select
            className="select"
            value={storeId}
            aria-label="门店筛选"
            onChange={(e) => setStoreId(e.target.value)}
          >
            <option value="">全部门店</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="date"
            aria-label="日期筛选"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Button variant="ghost" onClick={() => void load()}>
            查询
          </Button>
        </Toolbar>

        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          empty={
            tab === 'OVERDUE' ? '暂无超时配送单' : '暂无配送单'
          }
        />
      </Card>

      <Modal
        open={Boolean(acceptTarget)}
        title="接单"
        onClose={() => setAcceptTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAcceptTarget(null)}>
              取消
            </Button>
            <Button loading={acting} onClick={() => void submitAccept()}>
              确认接单
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="配送员姓名" hint="选填，填写后展示在订单详情">
            <input
              className="input"
              value={courierName}
              maxLength={20}
              onChange={(e) => setCourierName(e.target.value)}
            />
          </Field>
          <Field label="配送员电话" hint="选填，用户可联系配送员">
            <input
              className="input"
              value={courierPhone}
              maxLength={20}
              onChange={(e) => setCourierPhone(e.target.value)}
            />
          </Field>
        </div>
        {acceptTarget && (
          <p className="muted small">
            订单 {acceptTarget.orderNo} · {acceptTarget.storeName} · {acceptTarget.receiver}
          </p>
        )}
      </Modal>

      <Modal
        open={Boolean(cancelTarget)}
        title="取消配送"
        onClose={() => setCancelTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>
              返回
            </Button>
            <Button variant="danger" loading={acting} onClick={() => void submitCancel()}>
              确认取消
            </Button>
          </>
        }
      >
        <Field label="取消原因" hint="必填，会记录在配送单备注中">
          <textarea
            className="input"
            rows={3}
            maxLength={200}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
        </Field>
        {cancelTarget && (
          <p className="muted small">
            订单 {cancelTarget.orderNo} · {cancelTarget.receiver} ·{' '}
            {cancelTarget.address ?? '—'}
          </p>
        )}
      </Modal>
    </>
  );
}
