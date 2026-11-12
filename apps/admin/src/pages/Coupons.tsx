import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError, formatDate, money } from '../api/client';
import { can } from '../auth';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  Field,
  Modal,
  PageHeader,
  Pagination,
  Tag,
  Toolbar,
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
  const canWrite = can('coupon.edit');
  const [items, setItems] = useState<CouponRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [grantTarget, setGrantTarget] = useState<CouponRow | null>(null);
  const [grantAll, setGrantAll] = useState(false);
  const [userIds, setUserIds] = useState('');
  const [granting, setGranting] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [enabled, setEnabled] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  async function load() {
    setLoading(true);
    try {
      const result = await api<{ total: number; items: CouponRow[] }>('/admin/coupons', {
        query: {
          page,
          pageSize,
          keyword: appliedKeyword || undefined,
          enabled: enabled || undefined,
          type: typeFilter || undefined,
        },
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [page, pageSize, appliedKeyword, enabled, typeFilter]);

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
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            setAppliedKeyword(keyword.trim());
            setPage(1);
          }}
        >
          <Toolbar>
            <input
              className="input"
              style={{ width: 220 }}
              aria-label="搜索优惠券名称"
              placeholder="搜索优惠券名称…"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <select
              className="select"
              aria-label="按类型筛选"
              value={typeFilter}
              onChange={(event) => {
                setTypeFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部类型</option>
              <option value="THRESHOLD">满减券</option>
              <option value="NO_THRESHOLD">无门槛券</option>
            </select>
            <select
              className="select"
              aria-label="按状态筛选"
              value={enabled}
              onChange={(event) => {
                setEnabled(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部状态</option>
              <option value="true">发放中</option>
              <option value="false">已停用</option>
            </select>
            <div className="toolbar-actions">
              <Button
                type="button"
                variant="plain"
                onClick={() => {
                  setKeyword('');
                  setAppliedKeyword('');
                  setEnabled('');
                  setTypeFilter('');
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
        <DataTable columns={columns} rows={items} loading={loading} empty="还没有优惠券" />
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
