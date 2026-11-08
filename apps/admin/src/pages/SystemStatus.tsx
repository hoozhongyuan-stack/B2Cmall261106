import { useEffect, useState } from 'react';

import { api, ApiError, formatDate } from '../api/client';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  Pagination,
  Stat,
  Tag,
  type Column,
} from '../components/ui';

interface OpsStatus {
  now: string;
  uptimeSeconds: number;
  disk: { path: string; totalBytes: number; freeBytes: number; usedRatio: number };
  backup: {
    dir: string;
    latestFile: string | null;
    latestAt: string | null;
    ageHours: number | null;
    stale: boolean;
  };
  notifications: { pending: number; failed: number };
  refunds: { pending: number; abnormal: number; oldestPendingHours: number | null };
  payment: { provider: string; subscribeConfigured: boolean };
  alerts: { level: 'warn' | 'error'; code: string; message: string }[];
}

interface NotificationRow {
  id: string;
  scene: string;
  templateId: string;
  userId: string;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  nextRetryAt: string | null;
}

interface NotificationResult {
  total: number;
  page: number;
  pageSize: number;
  items: NotificationRow[];
}

interface RefundRow {
  id: string;
  refundNo: string;
  orderNo: string;
  afterSaleNo: string;
  amountCents: number;
  status: string;
  provider: string;
  channelStatus: string | null;
  transactionId: string | null;
  failReason: string | null;
  lastQueriedAt: string | null;
  createdAt: string;
}

interface RefundResult {
  total: number;
  page: number;
  pageSize: number;
  items: RefundRow[];
}

const PAGE_SIZE = 20;

const SCENE_LABEL: Record<string, string> = {
  ORDER_PAID: '支付成功',
  ORDER_SHIPPED: '订单发货',
  REFUND_RESULT: '退款结果',
};

const NOTIFY_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'muted' | 'brand'> = {
  SENT: 'ok',
  PENDING: 'brand',
  SKIPPED: 'muted',
  FAILED: 'danger',
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function money(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

export default function SystemStatus() {
  const [status, setStatus] = useState<OpsStatus | null>(null);
  const [notifications, setNotifications] = useState<NotificationResult | null>(null);
  const [refunds, setRefunds] = useState<RefundResult | null>(null);

  const [notifyStatus, setNotifyStatus] = useState('');
  const [notifyPage, setNotifyPage] = useState(1);
  const [refundStatus, setRefundStatus] = useState('PENDING');
  const [refundPage, setRefundPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  async function loadStatus() {
    try {
      const result = await api<OpsStatus>('/admin/ops/status');
      setStatus(result);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function loadNotifications(page = notifyPage, status = notifyStatus) {
    try {
      const result = await api<NotificationResult>('/admin/notifications/logs', {
        query: { page, pageSize: PAGE_SIZE, status: status || undefined },
      });
      setNotifications(result);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function loadRefunds(page = refundPage, status = refundStatus) {
    try {
      const result = await api<RefundResult>('/admin/refunds', {
        query: { page, pageSize: PAGE_SIZE, status: status || undefined },
      });
      setRefunds(result);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function refreshAll() {
    setLoading(true);
    await Promise.all([loadStatus(), loadNotifications(), loadRefunds()]);
    setLoading(false);
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  async function retryNotification(id: string) {
    setActing(id);
    try {
      await api(`/admin/notifications/${id}/retry`, { method: 'POST' });
      toast('已加入重试队列');
      await loadNotifications();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setActing(null);
    }
  }

  async function sendTest() {
    setActing('test');
    try {
      const result = await api<{ ok: boolean; error?: string }>('/admin/notifications/test', {
        method: 'POST',
      });
      if (result.ok) toast('测试通知已发送');
      else toast(result.error ?? '发送失败，请检查模板配置', 'error');
      await Promise.all([loadNotifications(), loadStatus()]);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setActing(null);
    }
  }

  async function queryRefund(id: string) {
    setActing(id);
    try {
      const result = await api<{ status: string; channelStatus: string | null }>(
        `/admin/refunds/${id}/query`,
        { method: 'POST' },
      );
      toast(`查询结果：${result.status}${result.channelStatus ? ` / ${result.channelStatus}` : ''}`);
      await Promise.all([loadRefunds(), loadStatus()]);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setActing(null);
    }
  }

  const notificationColumns: Column<NotificationRow>[] = [
    {
      key: 'scene',
      title: '场景',
      render: (row) => <span>{SCENE_LABEL[row.scene] ?? row.scene}</span>,
    },
    {
      key: 'status',
      title: '状态',
      render: (row) => <Tag tone={NOTIFY_TONE[row.status] ?? 'muted'}>{row.status}</Tag>,
    },
    { key: 'attempts', title: '尝试', render: (row) => <span className="mono small">{row.attempts}</span> },
    {
      key: 'error',
      title: '错误',
      render: (row) => (
        <span className="small muted" style={{ wordBreak: 'break-all' }}>
          {row.error ?? '—'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      title: '创建时间',
      render: (row) => <span className="small mono">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'action',
      title: '操作',
      render: (row) =>
        row.status === 'SENT' ? (
          <span className="muted small">—</span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            loading={acting === row.id}
            onClick={() => void retryNotification(row.id)}
          >
            重试
          </Button>
        ),
    },
  ];

  const refundColumns: Column<RefundRow>[] = [
    { key: 'refundNo', title: '退款单号', render: (row) => <span className="mono small">{row.refundNo}</span> },
    { key: 'orderNo', title: '订单号', render: (row) => <span className="mono small">{row.orderNo}</span> },
    { key: 'amountCents', title: '金额', render: (row) => <span>{money(row.amountCents)}</span> },
    { key: 'status', title: '状态', render: (row) => <span className="small">{row.status}</span> },
    {
      key: 'channelStatus',
      title: '渠道状态',
      render: (row) => (
        <span className="small">
          {row.channelStatus ?? '—'}
          {row.failReason ? <span className="muted">（{row.failReason}）</span> : null}
        </span>
      ),
    },
    {
      key: 'lastQueriedAt',
      title: '最近查询',
      render: (row) => <span className="small mono">{formatDate(row.lastQueriedAt)}</span>,
    },
    {
      key: 'action',
      title: '操作',
      render: (row) =>
        row.provider === 'wechat' ? (
          <Button
            size="sm"
            variant="ghost"
            loading={acting === row.id}
            onClick={() => void queryRefund(row.id)}
          >
            立即查询
          </Button>
        ) : (
          <span className="muted small">模拟渠道</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="系统状态"
        desc="磁盘与备份、订阅消息发送情况、退款对账；数据来自服务端实时统计"
      />

      <div className="grid grid-4">
        <Stat
          label="磁盘使用率"
          value={status ? `${(status.disk.usedRatio * 100).toFixed(1)}%` : '—'}
          tone={status && status.disk.usedRatio >= 0.85 ? 'warn' : 'ok'}
          hint={status ? `剩余 ${formatBytes(status.disk.freeBytes)}` : undefined}
        />
        <Stat
          label="最近备份"
          value={status?.backup.latestAt ? formatDate(status.backup.latestAt) : '无备份'}
          tone={status?.backup.stale ? 'warn' : 'ok'}
          hint={status?.backup.ageHours !== null && status ? `${status.backup.ageHours} 小时前` : undefined}
        />
        <Stat
          label="待处理退款"
          value={status?.refunds.pending ?? '—'}
          tone={status && status.refunds.pending > 0 ? 'warn' : 'ok'}
          hint={status ? `渠道异常 ${status.refunds.abnormal} 笔` : undefined}
        />
        <Stat
          label="通知失败"
          value={status?.notifications.failed ?? '—'}
          tone={status && status.notifications.failed > 0 ? 'warn' : 'ok'}
          hint={status ? `待发送 ${status.notifications.pending} 条` : undefined}
        />
      </div>

      {status?.alerts.length ? (
        <Card title="告警">
          <div style={{ display: 'grid', gap: 8 }}>
            {status.alerts.map((alert) => (
              <div
                key={alert.code}
                className="row"
                style={{
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: alert.level === 'error' ? 'var(--brand-soft)' : 'var(--gold-soft)',
                }}
              >
                <Tag tone={alert.level === 'error' ? 'danger' : 'warn'}>{alert.code}</Tag>
                <span className="small">{alert.message}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card
        title="订阅消息日志"
        extra={
          <div className="row" style={{ gap: 8 }}>
            <select
              className="input"
              style={{ width: 140 }}
              value={notifyStatus}
              onChange={(e) => {
                setNotifyStatus(e.target.value);
                setNotifyPage(1);
                void loadNotifications(1, e.target.value);
              }}
            >
              <option value="">全部状态</option>
              <option value="PENDING">待发送</option>
              <option value="SENT">已发送</option>
              <option value="SKIPPED">已跳过</option>
              <option value="FAILED">失败</option>
            </select>
            <Button variant="ghost" size="sm" loading={acting === 'test'} onClick={() => void sendTest()}>
              发送测试
            </Button>
            <Button variant="plain" size="sm" loading={loading} onClick={() => void refreshAll()}>
              刷新
            </Button>
          </div>
        }
      >
        <DataTable
          columns={notificationColumns}
          rows={notifications?.items ?? []}
          loading={loading}
          empty="暂无通知记录"
        />
        <Pagination
          page={notifyPage}
          total={notifications?.total ?? 0}
          pageSize={PAGE_SIZE}
          onChange={(page) => {
            setNotifyPage(page);
            void loadNotifications(page);
          }}
        />
      </Card>

      <Card
        title="退款对账"
        extra={
          <select
            className="input"
            style={{ width: 140 }}
            value={refundStatus}
            onChange={(e) => {
              setRefundStatus(e.target.value);
              setRefundPage(1);
              void loadRefunds(1, e.target.value);
            }}
          >
            <option value="PENDING">待确认</option>
            <option value="SUCCESS">已成功</option>
            <option value="FAILED">已失败</option>
            <option value="">全部</option>
          </select>
        }
      >
        <DataTable
          columns={refundColumns}
          rows={refunds?.items ?? []}
          loading={loading}
          empty="暂无退款单"
        />
        <Pagination
          page={refundPage}
          total={refunds?.total ?? 0}
          pageSize={PAGE_SIZE}
          onChange={(page) => {
            setRefundPage(page);
            void loadRefunds(page);
          }}
        />
      </Card>
    </>
  );
}
