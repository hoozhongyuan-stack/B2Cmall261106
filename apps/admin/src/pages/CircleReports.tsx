import { useEffect, useState } from 'react';

import { api, ApiError, formatDate } from '../api/client';
import { assetPreviewUrl } from '../api/assets';
import { can } from '../auth';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  Pagination,
  Tabs,
  Tag,
  type Column,
} from '../components/ui';

interface ReportRow {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  detail: string | null;
  status: string;
  createdAt: string;
  handledAt: string | null;
  reporter: { id: string; nickname: string | null };
  target: {
    content: string;
    status: string;
    author: { id: string; nickname: string | null };
    image: string | null;
  } | null;
}

interface ReportResult {
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  items: ReportRow[];
}

const TABS = [
  { value: '', label: '全部' },
  { value: 'PENDING', label: '待处理' },
  { value: 'RESOLVED', label: '已处理' },
  { value: 'REJECTED', label: '已驳回' },
];

const STATUS_META: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' }> = {
  PENDING: { label: '待处理', tone: 'warn' },
  RESOLVED: { label: '已处理', tone: 'ok' },
  REJECTED: { label: '已驳回', tone: 'muted' },
};

const TARGET_LABEL: Record<string, string> = {
  POST: '帖子',
  COMMENT: '评论',
  USER: '用户',
};

const PAGE_SIZE = 20;

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function CircleReports() {
  const canHandle = can('circle.audit');
  const [status, setStatus] = useState('');
  const [data, setData] = useState<ReportResult>({
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    counts: {},
    items: [],
  });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState('');

  async function load() {
    setLoading(true);
    try {
      const result = await api<ReportResult>('/admin/circle/reports', {
        query: { status, page, pageSize: PAGE_SIZE },
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
  }, [status, page]);

  async function handle(row: ReportRow, action: 'HIDE' | 'DISMISS') {
    setSaving(row.id);
    try {
      await api(`/admin/circle/reports/${row.id}`, {
        method: 'PATCH',
        body: { action },
      });
      toast(action === 'HIDE' ? '已下架并归档' : '已驳回举报');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving('');
    }
  }

  const columns: Column<ReportRow>[] = [
    {
      key: 'target',
      title: '被举报内容',
      minWidth: 300,
      render: (row) => (
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <Tag tone={row.targetType === 'POST' ? 'brand' : 'muted'}>
            {TARGET_LABEL[row.targetType] ?? row.targetType}
          </Tag>
          {row.target?.image && (
            <img
              src={assetPreviewUrl(row.target.image)}
              alt="被举报内容"
              style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }}
            />
          )}
          <div style={{ minWidth: 0 }}>
            <div className="cell-clip" style={{ maxWidth: 320 }}>
              {row.target?.content || '（内容已删除）'}
            </div>
            <div className="small muted">
              {row.target?.author.nickname ?? '未知作者'}
              {row.target ? ` · ${row.target.status}` : ''}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'reason',
      title: '举报原因',
      minWidth: 140,
      render: (row) => (
        <div>
          <div className="small">{row.reason}</div>
          {row.detail && <div className="small muted cell-clip">{row.detail}</div>}
        </div>
      ),
    },
    {
      key: 'reporter',
      title: '举报人',
      minWidth: 100,
      render: (row) => <span className="small">{row.reporter.nickname ?? '未设置昵称'}</span>,
    },
    {
      key: 'createdAt',
      title: '举报时间',
      minWidth: 150,
      nowrap: true,
      className: 'col-hide-lg',
      render: (row) => <span className="small mono">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'status',
      title: '状态',
      minWidth: 90,
      render: (row) => (
        <Tag tone={STATUS_META[row.status]?.tone ?? 'muted'}>
          {STATUS_META[row.status]?.label ?? row.status}
        </Tag>
      ),
    },
    {
      key: 'action',
      title: '操作',
      align: 'right',
      width: '170px',
      render: (row) =>
        canHandle && row.status === 'PENDING' ? (
          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <Button
              size="sm"
              variant="ghost"
              loading={saving === row.id}
              onClick={() => void handle(row, 'HIDE')}
            >
              下架
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={saving === row.id}
              onClick={() => void handle(row, 'DISMISS')}
            >
              驳回
            </Button>
          </div>
        ) : (
          <span className="small muted">{row.handledAt ? formatDate(row.handledAt) : '—'}</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="圈子举报处理"
        desc="同一内容被 3 人举报会自动隐藏待审；处理结果会留痕，作者内容状态同步更新"
      />

      <Tabs
        items={TABS.map((item) => ({ ...item, count: data.counts[item.value || 'ALL'] ?? 0 }))}
        value={status}
        onChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
      />

      <Card>
        <DataTable columns={columns} rows={data.items} loading={loading} empty="暂无举报" />
        {data.total > PAGE_SIZE && (
          <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
        )}
      </Card>
    </>
  );
}
