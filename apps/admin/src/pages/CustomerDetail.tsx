import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ORDER_STATUS_LABEL, type OrderStatus } from '@shanye/shared/src/orderState';

import { api, ApiError, formatDate, money } from '../api/client';
import { hasRole } from '../auth';
import { toast } from '../components/toast';
import { TagPicker, type TagOption } from '../components/TagPicker';
import {
  Button,
  Card,
  DataTable,
  Empty,
  Field,
  KeyValue,
  Modal,
  PageHeader,
  Stat,
  Tag,
  type Column,
} from '../components/ui';

interface RecentOrder {
  id: string;
  orderNo: string;
  status: string;
  payableCents: number;
  createdAt: string;
  itemCount: number;
  firstItemTitle: string;
}

interface PointsRow {
  id: string;
  delta: number;
  source: string;
  reason: string | null;
  balanceAfter: number;
  createdAt: string;
}

interface CustomerTag {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
}

interface CustomerDetailData {
  id: string;
  nickname: string | null;
  phone: string | null;
  avatarKey: string | null;
  openid: string;
  createdAt: string;
  points: number;
  totalSpentCents: number;
  tags: CustomerTag[];
  level: { name: string; discountRate: number; thresholdCents: number } | null;
  nextLevel: { name: string; thresholdCents: number; remainCents: number } | null;
  stats: {
    orderCount: number;
    paidCents: number;
    refundedCents: number;
    netCents: number;
    lastOrderAt: string | null;
  };
  coupons: { status: string; count: number }[];
  recentOrders: RecentOrder[];
  recentPoints: PointsRow[];
}

const POINTS_SOURCE_LABEL: Record<string, string> = {
  ORDER_PAID: '订单支付',
  REFUND: '退款扣回',
  ADMIN: '后台调整',
};

const COUPON_STATUS_LABEL: Record<string, string> = {
  UNUSED: '未使用',
  USED: '已使用',
  EXPIRED: '已过期',
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<CustomerDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [tagOptions, setTagOptions] = useState<TagOption[]>([]);
  const [tagOpen, setTagOpen] = useState(false);
  const [pickedTags, setPickedTags] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  useEffect(() => {
    api<{ items: TagOption[] }>('/admin/user-tags/options')
      .then((result) => setTagOptions(result.items))
      .catch(() => undefined);
  }, []);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const result = await api<CustomerDetailData>(`/admin/customers/${id}`);
      setData(result);
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

  async function adjustPoints() {
    if (!id) return;
    const value = Number(delta);
    if (!Number.isInteger(value) || value === 0) {
      toast('积分变动必须为非零整数', 'error');
      return;
    }
    if (!reason.trim()) {
      toast('请填写调整原因', 'error');
      return;
    }
    setSaving(true);
    try {
      await api(`/admin/customers/${id}/points`, {
        method: 'POST',
        body: { delta: value, reason: reason.trim() },
      });
      toast('已调整积分');
      setPointsOpen(false);
      setDelta('');
      setReason('');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function saveTags() {
    if (!id) return;
    setSavingTags(true);
    try {
      await api('/admin/customers/batch/tags', {
        method: 'POST',
        body: { userIds: [id], tagIds: pickedTags, mode: 'replace' },
      });
      toast('已更新标签');
      setTagOpen(false);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSavingTags(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="客户详情" />
        <div className="table-loading">加载中…</div>
      </>
    );
  }

  if (notFound || !data) {
    return (
      <>
        <PageHeader title="客户详情" />
        <Card>
          <Empty text="客户不存在或已被删除" />
        </Card>
      </>
    );
  }

  const canAdjust = hasRole('SUPER', 'CS');

  const orderColumns: Column<RecentOrder>[] = [
    { key: 'orderNo', title: '订单号', render: (row) => <span className="mono small">{row.orderNo}</span> },
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
      title: '金额',
      align: 'right',
      render: (row) => <span className="money">{money(row.payableCents)}</span>,
    },
    {
      key: 'status',
      title: '状态',
      render: (row) => (
        <Tag>{ORDER_STATUS_LABEL[row.status as OrderStatus] ?? row.status}</Tag>
      ),
    },
    {
      key: 'createdAt',
      title: '下单时间',
      render: (row) => <span className="small mono">{formatDate(row.createdAt)}</span>,
    },
  ];

  const pointsColumns: Column<PointsRow>[] = [
    {
      key: 'createdAt',
      title: '时间',
      render: (row) => <span className="small mono">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'delta',
      title: '变动',
      align: 'right',
      render: (row) => (
        <span className="mono" style={{ color: row.delta >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
          {row.delta > 0 ? `+${row.delta}` : row.delta}
        </span>
      ),
    },
    {
      key: 'source',
      title: '来源',
      render: (row) => <Tag>{POINTS_SOURCE_LABEL[row.source] ?? row.source}</Tag>,
    },
    { key: 'reason', title: '说明', render: (row) => <span className="small">{row.reason || '—'}</span> },
    {
      key: 'balanceAfter',
      title: '余额',
      align: 'right',
      render: (row) => <span className="mono">{row.balanceAfter}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title={data.nickname ?? '山野顾客'}
        desc={data.phone ?? '未绑定手机号'}
        actions={
          <div className="row">
            <Button variant="ghost" onClick={() => navigate('/customers')}>
              返回列表
            </Button>
            {canAdjust && <Button onClick={() => setPointsOpen(true)}>调整积分</Button>}
          </div>
        }
      />

      <div className="grid grid-4">
        <Stat label="订单数" value={data.stats.orderCount} />
        <Stat label="累计实付" value={money(data.stats.paidCents)} tone="brand" />
        <Stat label="累计退款" value={money(data.stats.refundedCents)} tone="warn" />
        <Stat label="净消费" value={money(data.stats.netCents)} tone="ok" />
      </div>

      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <Card title="会员资产">
          <KeyValue
            items={[
              { label: '当前等级', value: data.level ? data.level.name : '普通会员' },
              {
                label: '等级折扣',
                value: data.level ? `${(data.level.discountRate * 10).toFixed(1)} 折` : '—',
              },
              { label: '积分余额', value: <span className="mono">{data.points}</span> },
              {
                label: '累计消费',
                value: <span className="money">{money(data.totalSpentCents)}</span>,
              },
              {
                label: '下一等级',
                value: data.nextLevel
                  ? `${data.nextLevel.name}（还需 ${money(data.nextLevel.remainCents)}）`
                  : '已满级',
              },
              { label: '注册时间', value: formatDate(data.createdAt) },
            ]}
          />
        </Card>
        <Card title="优惠券与交易">
          <KeyValue
            items={[
              {
                label: '优惠券',
                value:
                  data.coupons.length > 0
                    ? data.coupons
                        .map((item) => `${COUPON_STATUS_LABEL[item.status] ?? item.status} ${item.count} 张`)
                        .join('，')
                    : '暂无优惠券',
              },
              { label: '最近下单', value: formatDate(data.stats.lastOrderAt) },
              { label: 'openid', value: <span className="mono small">{data.openid}</span> },
            ]}
          />
        </Card>
      </div>

      <Card
        title="客户标签"
        extra={
          hasRole('SUPER', 'OPS', 'CS') ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPickedTags(data.tags.map((tag) => tag.id));
                setTagOpen(true);
              }}
            >
              编辑标签
            </Button>
          ) : undefined
        }
      >
        {data.tags.length ? (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {data.tags.map((tag) => (
              <Tag key={tag.id} tone={tag.parentId ? 'ok' : 'brand'}>
                {tag.parentName ? `${tag.parentName} / ${tag.name}` : tag.name}
              </Tag>
            ))}
          </div>
        ) : (
          <span className="muted small">暂未打标签</span>
        )}
      </Card>

      <Card title="最近订单">
        <DataTable
          columns={orderColumns}
          rows={data.recentOrders}
          empty="暂无订单"
          onRowClick={(row) => navigate(`/orders/${row.id}`)}
        />
      </Card>

      <Card title="积分流水" extra={<span className="small muted">最近 10 条</span>}>
        <DataTable columns={pointsColumns} rows={data.recentPoints} empty="暂无积分流水" />
      </Card>

      <Modal
        open={tagOpen}
        title="编辑客户标签"
        onClose={() => setTagOpen(false)}
        footer={
          <>
            <Button variant="plain" onClick={() => setTagOpen(false)}>
              取消
            </Button>
            <Button loading={savingTags} onClick={() => void saveTags()}>
              保存标签
            </Button>
          </>
        }
      >
        <p className="small muted" style={{ marginTop: 0 }}>
          标签支持多选，保存后覆盖该客户现有标签。
        </p>
        <TagPicker options={tagOptions} selected={pickedTags} onChange={setPickedTags} />
      </Modal>

      <Modal
        open={pointsOpen}
        title="调整积分"
        onClose={() => setPointsOpen(false)}
        footer={
          <>
            <Button variant="plain" onClick={() => setPointsOpen(false)}>
              取消
            </Button>
            <Button loading={saving} onClick={() => void adjustPoints()}>
              确认调整
            </Button>
          </>
        }
      >
        <Field label="积分变动" hint="正数为发放，负数为扣减，必须为非零整数">
          <input
            className="input"
            type="number"
            value={delta}
            placeholder="例如：100 或 -50"
            onChange={(e) => setDelta(e.target.value)}
          />
        </Field>
        <Field label="调整原因" hint="会记入积分流水，必填">
          <input
            className="input"
            value={reason}
            placeholder="例如：活动补发"
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </Modal>
    </>
  );
}
