import { useEffect, useState } from 'react';

import { api, ApiError, formatDate } from '../api/client';
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
  Toolbar,
  type Column,
} from '../components/ui';

interface CommentRow {
  id: string;
  content: string;
  hidden: boolean;
  parentId: string | null;
  createdAt: string;
  author: { id: string; nickname: string | null; avatarKey: string | null };
  post: { id: string; excerpt: string; image: string | null };
}

interface CommentResult {
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  items: CommentRow[];
}

const TABS = [
  { value: '', label: '全部' },
  { value: 'false', label: '已展示' },
  { value: 'true', label: '已隐藏' },
];

const PAGE_SIZE = 20;

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function CircleComments() {
  const canAudit = can('circle.audit');
  const [hidden, setHidden] = useState('');
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [data, setData] = useState<CommentResult>({
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    counts: {},
    items: [],
  });

  async function load() {
    setLoading(true);
    try {
      setData(
        await api<CommentResult>('/admin/circle/comments', {
          query: {
            hidden,
            keyword: appliedKeyword || undefined,
            page,
            pageSize: PAGE_SIZE,
          },
        }),
      );
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [hidden, page, appliedKeyword]);

  async function toggle(row: CommentRow) {
    setSaving(row.id);
    try {
      await api(`/admin/circle/comments/${row.id}`, {
        method: 'PATCH',
        body: { hidden: !row.hidden },
      });
      toast(row.hidden ? '已恢复展示' : '已隐藏评论');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving('');
    }
  }

  const columns: Column<CommentRow>[] = [
    {
      key: 'content',
      title: '评论内容',
      minWidth: 280,
      render: (row) => (
        <div>
          <div className="cell-clip" style={{ maxWidth: 360 }}>
            {row.parentId ? '回复：' : ''}
            {row.content}
          </div>
          <div className="small muted cell-clip" style={{ maxWidth: 360 }}>
            来自：{row.post.excerpt || '（无正文）'}
          </div>
        </div>
      ),
    },
    {
      key: 'author',
      title: '评论人',
      minWidth: 110,
      render: (row) => <span className="small">{row.author.nickname ?? '未设置昵称'}</span>,
    },
    {
      key: 'createdAt',
      title: '时间',
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
        <Tag tone={row.hidden ? 'muted' : 'ok'}>{row.hidden ? '已隐藏' : '已展示'}</Tag>
      ),
    },
    {
      key: 'action',
      title: '操作',
      align: 'right',
      width: '120px',
      render: (row) =>
        canAudit ? (
          <Button size="sm" variant="ghost" loading={saving === row.id} onClick={() => void toggle(row)}>
            {row.hidden ? '恢复' : '隐藏'}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="圈子评论管理"
        desc="隐藏后不再展示在小程序评论区，帖子评论数同步扣减"
      />

      <Tabs
        items={TABS.map((item) => ({
          ...item,
          count: data.counts[item.value === '' ? 'ALL' : item.value === 'false' ? 'SHOWN' : 'HIDDEN'] ?? 0,
        }))}
        value={hidden}
        onChange={(value) => {
          setHidden(value);
          setPage(1);
        }}
      />

      <Card>
        <Toolbar>
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder="搜索评论内容或评论人"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPage(1);
                setAppliedKeyword(keyword.trim());
              }
            }}
          />
          <Button
            variant="plain"
            onClick={() => {
              setPage(1);
              setAppliedKeyword(keyword.trim());
            }}
          >
            搜索
          </Button>
          {appliedKeyword && (
            <Button
              variant="plain"
              onClick={() => {
                setKeyword('');
                setAppliedKeyword('');
                setPage(1);
              }}
            >
              重置
            </Button>
          )}
          <span className="muted small">共 {data.total} 条</span>
        </Toolbar>

        <DataTable columns={columns} rows={data.items} loading={loading} empty="暂无评论" />

        {data.total > PAGE_SIZE && (
          <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
        )}
      </Card>
    </>
  );
}
