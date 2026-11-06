import { useEffect, useState, type FormEvent } from 'react';

import { api, ApiError, formatDate } from '../api/client';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  Pagination,
  Toolbar,
  type Column,
} from '../components/ui';

interface LogRow {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  beforeJson: unknown;
  afterJson: unknown;
  ip: string | null;
  createdAt: string;
}

interface LogResult {
  items: LogRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface Filters {
  targetType: string;
  keyword: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { targetType: '', keyword: '', from: '', to: '' };
const PAGE_SIZE = 20;

function summarize(value: unknown): string {
  if (value === null || value === undefined) return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '—';
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '加载失败';
}

export default function Logs() {
  const [items, setItems] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const result = await api<LogResult>('/admin/logs', {
          query: {
            page,
            pageSize: PAGE_SIZE,
            targetType: applied.targetType,
            keyword: applied.keyword,
            from: toIso(applied.from),
            to: toIso(applied.to),
          },
        });
        if (alive) {
          setItems(result.items);
          setTotal(result.total);
        }
      } catch (err) {
        if (alive) toast(errorText(err), 'error');
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [page, applied]);

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setApplied({
      targetType: draft.targetType.trim(),
      keyword: draft.keyword.trim(),
      from: draft.from,
      to: draft.to,
    });
  }

  const columns: Column<LogRow>[] = [
    {
      key: 'createdAt',
      title: '时间',
      render: (row) => <span className="small mono">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'actorName',
      title: '操作人',
      render: (row) => <span>{row.actorName || row.actorId}</span>,
    },
    { key: 'action', title: '动作', render: (row) => <span className="mono small">{row.action}</span> },
    {
      key: 'target',
      title: '对象',
      render: (row) => (
        <div>
          <div className="small">{row.targetType}</div>
          <div className="mono small muted">{row.targetId || '—'}</div>
        </div>
      ),
    },
    {
      key: 'summary',
      title: '摘要',
      render: (row) => (
        <span className="mono small" style={{ wordBreak: 'break-all' }}>
          {summarize(row.afterJson)}
        </span>
      ),
    },
    { key: 'ip', title: 'IP', render: (row) => <span className="mono small">{row.ip ?? '—'}</span> },
  ];

  return (
    <>
      <PageHeader title="操作日志" desc="记录后台写操作，便于追溯与审计" />

      <Card>
        <form onSubmit={handleSearch}>
          <Toolbar>
            <input
              className="input"
              style={{ width: 200 }}
              placeholder="搜索动作 / 操作人 / 对象 ID"
              value={draft.keyword}
              onChange={(e) => setDraft((prev) => ({ ...prev, keyword: e.target.value }))}
            />
            <input
              className="input"
              style={{ width: 160 }}
              placeholder="对象类型，例如 product"
              value={draft.targetType}
              onChange={(e) => setDraft((prev) => ({ ...prev, targetType: e.target.value }))}
            />
            <input
              className="input"
              type="datetime-local"
              value={draft.from}
              onChange={(e) => setDraft((prev) => ({ ...prev, from: e.target.value }))}
            />
            <span className="muted small">至</span>
            <input
              className="input"
              type="datetime-local"
              value={draft.to}
              onChange={(e) => setDraft((prev) => ({ ...prev, to: e.target.value }))}
            />
            <Button type="submit" variant="ghost">
              筛选
            </Button>
            <Button
              type="button"
              variant="plain"
              onClick={() => {
                setDraft(EMPTY_FILTERS);
                setPage(1);
                setApplied(EMPTY_FILTERS);
              }}
            >
              重置
            </Button>
          </Toolbar>
        </form>

        <DataTable columns={columns} rows={items} loading={loading} empty="暂无操作日志" />
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
      </Card>
    </>
  );
}
