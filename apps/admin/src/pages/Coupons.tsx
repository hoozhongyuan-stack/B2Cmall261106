import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError, formatDate, money } from '../api/client';
import { hasRole } from '../auth';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  Field,
  Modal,
  PageHeader,
  Tag,
  type Column,
} from '../components/ui';

interface CouponRow {
  id: string;
  name: string;
  type: string;
  thresholdCents: number;
  faceValueCents: number;
  total: number;
  claimed: number;
  perLimit: number;
  channel: string;
  startAt: string;
  endAt: string;
  enabled: boolean;
  usedCount: number;
}

interface GrantResult {
  granted: number;
  skipped: { userId: string; reason: string }[];
}

const TYPE_LABEL: Record<string, string> = {
  THRESHOLD: '满减券',
  NO_THRESHOLD: '无门槛券',
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function Coupons() {
  const navigate = useNavigate();
  const canWrite = hasRole('SUPER', 'OPS');
  const [items, setItems] = useState<CouponRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [grantTarget, setGrantTarget] = useState<CouponRow | null>(null);
  const [grantAll, setGrantAll] = useState(false);
  const [userIds, setUserIds] = useState('');
  const [granting, setGranting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await api<{ items: CouponRow[] }>('/admin/coupons');
      setItems(result.items);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(row: CouponRow) {
    try {
      await api(`/admin/coupons/${row.id}/toggle`, { method: 'POST' });
      toast('已保存');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function grant() {
    if (!grantTarget) return;
    let body: { all?: boolean; userIds?: string[] } = {};
    if (grantAll) {
      body = { all: true };
    } else {
      const ids = userIds
        .split(/[,\s，、]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (!ids.length) {
        toast('请填写客户 ID 或选择全量发放', 'error');
        return;
      }
      body = { userIds: ids };
    }
    setGranting(true);
    try {
      const result = await api<GrantResult>(`/admin/coupons/${grantTarget.id}/grant`, {
        method: 'POST',
        body,
      });
      const skipped = result.skipped.length;
      toast(`已发放 ${result.granted} 张${skipped ? `，${skipped} 张被跳过` : ''}`);
      setGrantTarget(null);
      setUserIds('');
      setGrantAll(false);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setGranting(false);
    }
  }

  const columns: Column<CouponRow>[] = [
    { key: 'name', title: '名称', render: (row) => <strong>{row.name}</strong> },
    { key: 'type', title: '类型', render: (row) => <span>{TYPE_LABEL[row.type] ?? row.type}</span> },
    {
      key: 'faceValueCents',
      title: '面额',
      align: 'right',
      render: (row) => <span className="money">{money(row.faceValueCents)}</span>,
    },
    {
      key: 'thresholdCents',
      title: '使用门槛',
      align: 'right',
      render: (row) =>
        row.thresholdCents > 0 ? (
          <span className="mono">满 {money(row.thresholdCents)}</span>
        ) : (
          <span className="muted">无门槛</span>
        ),
    },
    {
      key: 'claimed',
      title: '已领 / 总量',
      align: 'right',
      render: (row) => (
        <span className="mono">
          {row.claimed} / {row.total}
        </span>
      ),
    },
    {
      key: 'validity',
      title: '有效期',
      render: (row) => (
        <span className="small">
          {formatDate(row.startAt)}
          <br />
          至 {formatDate(row.endAt)}
        </span>
      ),
    },
    {
      key: 'enabled',
      title: '状态',
      render: (row) => (
        <Tag tone={row.enabled ? 'ok' : 'muted'}>{row.enabled ? '发放中' : '已停用'}</Tag>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      align: 'right',
      render: (row) => (
        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
          {canWrite && (
            <>
              <Button size="sm" variant="ghost" onClick={() => void toggle(row)}>
                {row.enabled ? '停用' : '启用'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setGrantTarget(row);
                  setGrantAll(false);
                  setUserIds('');
                }}
              >
                发放
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => navigate(`/coupons/${row.id}/claims`)}>
            发放记录
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="优惠券"
        desc="新建满减 / 无门槛券，启停发放并查看领取记录"
        actions={
          canWrite ? <Button onClick={() => navigate('/coupons/new')}>新建优惠券</Button> : undefined
        }
      />

      <Card>
        <DataTable columns={columns} rows={items} loading={loading} empty="还没有优惠券" />
      </Card>

      <Modal
        open={Boolean(grantTarget)}
        title={`发放优惠券${grantTarget ? ` · ${grantTarget.name}` : ''}`}
        onClose={() => setGrantTarget(null)}
        footer={
          <>
            <Button variant="plain" onClick={() => setGrantTarget(null)}>
              取消
            </Button>
            <Button loading={granting} onClick={() => void grant()}>
              确认发放
            </Button>
          </>
        }
      >
        <Field label="发放方式">
          <select
            className="select"
            value={grantAll ? 'all' : 'users'}
            onChange={(e) => setGrantAll(e.target.value === 'all')}
          >
            <option value="users">指定客户</option>
            <option value="all">全量客户（最多 200 人）</option>
          </select>
        </Field>
        {!grantAll && (
          <Field label="客户 ID" hint="多个 ID 用逗号、空格或换行分隔">
            <textarea
              className="textarea"
              value={userIds}
              placeholder="user_xxx, user_yyy"
              onChange={(e) => setUserIds(e.target.value)}
            />
          </Field>
        )}
      </Modal>
    </>
  );
}
