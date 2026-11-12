import { useEffect, useState } from 'react';

import { api, ApiError, formatDate } from '../api/client';
import { can } from '../auth';
import { toast } from '../components/toast';
import {
  BulkBar,
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

interface ReviewRow {
  id: string;
  rating: number;
  content: string | null;
  images: string[];
  anonymous: boolean;
  status: string;
  reply: string | null;
  createdAt: string;
  item: { title: string; specText: string; imageKey: string | null } | null;
  orderNo: string;
  customer: { nickname: string | null; phone: string | null };
}

interface ReviewResult {
  counts: { status: string; count: number }[];
  items: ReviewRow[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: '待审核',
  SHOWN: '已展示',
  HIDDEN: '已隐藏',
};

const STATUS_TABS = [
  { value: '', label: '全部' },
  { value: 'PENDING', label: '待审核' },
  { value: 'SHOWN', label: '已展示' },
  { value: 'HIDDEN', label: '已隐藏' },
];

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function Reviews() {
  const canModerate = can('review.manage');
  const [status, setStatus] = useState('');
  const [data, setData] = useState<ReviewResult>({
    counts: [],
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  const [loading, setLoading] = useState(true);
  const [replyTarget, setReplyTarget] = useState<ReviewRow | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [rating, setRating] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [batching, setBatching] = useState(false);
  const PAGE_SIZE = 20;

  async function load() {
    setLoading(true);
    try {
      const result = await api<ReviewResult>('/admin/reviews', {
        query: {
          status,
          page,
          pageSize: PAGE_SIZE,
          keyword: appliedKeyword || undefined,
          rating: rating || undefined,
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
    void load();
  }, [status, page, appliedKeyword, rating, startDate, endDate]);

  useEffect(() => {
    setSelected([]);
  }, [status, page, appliedKeyword, rating, startDate, endDate]);

  async function batchModerate(action: 'show' | 'hide') {
    setBatching(true);
    try {
      const result = await api<{ success: number; failed: number }>('/admin/reviews/batch/moderate', {
        method: 'POST',
        body: { ids: selected, action },
      });
      toast(
        `已${action === 'show' ? '通过' : '隐藏'} ${result.success} 条评价${
          result.failed ? `，${result.failed} 条失败` : ''
        }`,
        result.failed ? 'error' : 'success',
      );
      setSelected([]);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBatching(false);
    }
  }

  async function moderate(row: ReviewRow, action: 'show' | 'hide') {
    try {
      await api(`/admin/reviews/${row.id}/moderate`, { method: 'POST', body: { action } });
      toast('已处理');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function submitReply() {
    if (!replyTarget) return;
    if (!replyContent.trim()) {
      toast('请填写回复内容', 'error');
      return;
    }
    setSaving(true);
    try {
      await api(`/admin/reviews/${replyTarget.id}/reply`, {
        method: 'POST',
        body: { content: replyContent.trim() },
      });
      toast('已回复');
      setReplyTarget(null);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  const countMap = new Map(data.counts.map((item) => [item.status, item.count]));
  const total = data.counts.reduce((sum, item) => sum + item.count, 0);
  const tabs = STATUS_TABS.map((tab) => ({
    ...tab,
    count: tab.value ? (countMap.get(tab.value) ?? 0) : total,
  }));

  const columns: Column<ReviewRow>[] = [
    {
      key: 'item',
      title: '商品',
      render: (row) => (
        <div>
          <div>{row.item?.title ?? '—'}</div>
          <div className="small muted">{row.item?.specText ?? ''}</div>
        </div>
      ),
    },
    {
      key: 'rating',
      title: '评分',
      render: (row) => (
        <span>
          <span style={{ color: 'var(--brand)' }}>{'★'.repeat(row.rating)}</span>
          <span className="muted">{'☆'.repeat(Math.max(5 - row.rating, 0))}</span>
        </span>
      ),
    },
    {
      key: 'content',
      title: '评价内容',
      render: (row) => (
        <div>
          <div style={{ maxWidth: 320 }}>{row.content || '（未填写文字）'}</div>
          {row.images.length > 0 && (
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              {row.images.map((src, index) => (
                <img
                  key={`${row.id}-${index}`}
                  src={src}
                  alt="评价图"
                  style={{
                    width: 44,
                    height: 44,
                    objectFit: 'cover',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface-2)',
                  }}
                />
              ))}
            </div>
          )}
          {row.reply && (
            <div className="small muted" style={{ marginTop: 4 }}>
              商家回复：{row.reply}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'customer',
      title: '客户',
      render: (row) => (
        <div>
          <div>{row.customer.nickname ?? '匿名用户'}</div>
          <div className="small muted">{row.anonymous ? '匿名评价' : row.customer.phone ?? '—'}</div>
        </div>
      ),
    },
    {
      key: 'status',
      title: '状态',
      render: (row) => (
        <Tag
          tone={row.status === 'SHOWN' ? 'ok' : row.status === 'HIDDEN' ? 'danger' : 'warn'}
        >
          {STATUS_LABEL[row.status] ?? row.status}
        </Tag>
      ),
    },
    {
      key: 'createdAt',
      title: '评价时间',
      render: (row) => <span className="small mono">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'actions',
      title: '操作',
      align: 'right',
      render: (row) =>
        canModerate ? (
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
            {row.status !== 'SHOWN' && (
              <Button size="sm" variant="ghost" onClick={() => void moderate(row, 'show')}>
                展示
              </Button>
            )}
            {row.status !== 'HIDDEN' && (
              <Button size="sm" variant="ghost" onClick={() => void moderate(row, 'hide')}>
                隐藏
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setReplyTarget(row);
                setReplyContent(row.reply ?? '');
              }}
            >
              回复
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title="评价管理" desc="先审后显：待审核评价通过后才会展示给买家" />

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
              aria-label="搜索评价内容或订单号"
              placeholder="搜索评价内容 / 订单号 / 商品…"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <select
              className="select"
              aria-label="按评分筛选"
              value={rating}
              onChange={(event) => {
                setRating(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部评分</option>
              {[5, 4, 3, 2, 1].map((value) => (
                <option key={value} value={String(value)}>
                  {value} 星
                </option>
              ))}
            </select>
            <input
              className="input"
              type="date"
              style={{ width: 148 }}
              aria-label="评价开始日期"
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
              aria-label="评价结束日期"
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
                  setRating('');
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
          empty="当前筛选下暂无评价"
          selection={canModerate ? { selected, onChange: setSelected } : undefined}
        />
        <Pagination
          page={page}
          total={data.total ?? data.items.length}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      </Card>

      <BulkBar
        count={selected.length}
        onClear={() => setSelected([])}
        actions={[
          { label: '通过展示', onClick: () => void batchModerate('show'), disabled: batching },
          { label: '隐藏', onClick: () => void batchModerate('hide'), disabled: batching },
        ]}
      />

      <Modal
        open={Boolean(replyTarget)}
        title="回复评价"
        onClose={() => setReplyTarget(null)}
        footer={
          <>
            <Button variant="plain" onClick={() => setReplyTarget(null)}>
              取消
            </Button>
            <Button loading={saving} onClick={() => void submitReply()}>
              保存回复
            </Button>
          </>
        }
      >
        <Field label="回复内容" hint="回复将展示在商品评价下方">
          <textarea
            className="textarea"
            value={replyContent}
            placeholder="感谢您的评价…"
            onChange={(e) => setReplyContent(e.target.value)}
          />
        </Field>
      </Modal>
    </>
  );
}
