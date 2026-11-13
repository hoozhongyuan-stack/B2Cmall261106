import { useEffect, useState } from 'react';

import { api, ApiError, formatDate } from '../api/client';
import { assetPreviewUrl } from '../api/assets';
import { can } from '../auth';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  Field,
  KeyValue,
  Modal,
  PageHeader,
  Pagination,
  Tabs,
  Tag,
  Toolbar,
  type Column,
} from '../components/ui';

interface PostRow {
  id: string;
  content: string;
  images: string[];
  status: string;
  auditNote: string | null;
  pinned: boolean;
  featured: boolean;
  likeCount: number;
  commentCount: number;
  favoriteCount: number;
  viewCount: number;
  productCount: number;
  rewardedAt: string | null;
  createdAt: string;
  publishedAt: string | null;
  auditedAt: string | null;
  author: { id: string; nickname: string | null; avatarKey: string | null };
  category: { id: string; name: string };
  topics: { id: string; name: string }[];
}

interface PostResult {
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  items: PostRow[];
}

const STATUS_TABS = [
  { value: '', label: '全部' },
  { value: 'PENDING', label: '待审核' },
  { value: 'PUBLISHED', label: '已发布' },
  { value: 'REJECTED', label: '已拒绝' },
  { value: 'HIDDEN', label: '已隐藏' },
];

const STATUS_META: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' | 'brand' }> = {
  PENDING: { label: '待审核', tone: 'warn' },
  PUBLISHED: { label: '已发布', tone: 'ok' },
  REJECTED: { label: '已拒绝', tone: 'danger' },
  HIDDEN: { label: '已隐藏', tone: 'muted' },
};

const PAGE_SIZE = 20;

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function CirclePosts() {
  const canAudit = can('circle.audit');
  const [status, setStatus] = useState('');
  const [data, setData] = useState<PostResult>({
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    counts: {},
    items: [],
  });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [preview, setPreview] = useState<PostRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PostRow | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await api<PostResult>('/admin/circle/posts', {
        query: {
          status,
          page,
          pageSize: PAGE_SIZE,
          keyword: appliedKeyword || undefined,
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
  }, [status, page, appliedKeyword]);

  function switchStatus(value: string) {
    setStatus(value);
    setPage(1);
  }

  async function audit(row: PostRow, action: 'APPROVE' | 'HIDE', note?: string) {
    setSaving(true);
    try {
      await api(`/admin/circle/posts/${row.id}/audit`, {
        method: 'PATCH',
        body: { action, note },
      });
      toast(action === 'APPROVE' ? '已通过并发布' : '已隐藏');
      setPreview(null);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleFlag(row: PostRow, key: 'pinned' | 'featured') {
    try {
      await api(`/admin/circle/posts/${row.id}/flags`, {
        method: 'PATCH',
        body: { [key]: !row[key] },
      });
      toast(key === 'pinned' ? (row.pinned ? '已取消置顶' : '已置顶') : row.featured ? '已取消精选' : '已设为精选');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function submitReject() {
    if (!rejectTarget) return;
    if (!rejectNote.trim()) {
      toast('请填写拒绝原因', 'error');
      return;
    }
    setSaving(true);
    try {
      await api(`/admin/circle/posts/${rejectTarget.id}/audit`, {
        method: 'PATCH',
        body: { action: 'REJECT', note: rejectNote.trim() },
      });
      toast('已拒绝，原因将在「我的圈子」中展示');
      setRejectTarget(null);
      setRejectNote('');
      setPreview(null);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<PostRow>[] = [
    {
      key: 'content',
      title: '内容',
      minWidth: 300,
      render: (row) => (
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          {row.images.length ? (
            <div className="row" style={{ gap: 4 }}>
              {row.images.slice(0, 3).map((key) => (
                <img
                  key={key}
                  src={assetPreviewUrl(key)}
                  alt="内容图片"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 8,
                    objectFit: 'cover',
                    flex: '0 0 auto',
                  }}
                />
              ))}
              {row.images.length > 3 && (
                <span className="small muted" style={{ alignSelf: 'center' }}>
                  +{row.images.length - 3}
                </span>
              )}
            </div>
          ) : (
            <span className="tag tag--muted">纯文字</span>
          )}
          <div className="cell-clip" style={{ maxWidth: 240 }}>
            {row.content || '（无正文）'}
          </div>
        </div>
      ),
    },
    {
      key: 'author',
      title: '作者',
      minWidth: 110,
      render: (row) => <span className="small">{row.author.nickname ?? '未设置昵称'}</span>,
    },
    {
      key: 'taxonomy',
      title: '类目 / 话题',
      minWidth: 150,
      render: (row) => (
        <div>
          <div className="small">{row.category.name}</div>
          {row.topics.length > 0 && (
            <div className="small muted cell-clip">
              {row.topics.map((topic) => `#${topic.name}`).join(' ')}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'stats',
      title: '互动',
      minWidth: 100,
      nowrap: true,
      render: (row) => (
        <span className="small mono">
          {row.likeCount} / {row.commentCount}
        </span>
      ),
    },
    {
      key: 'createdAt',
      title: '提交时间',
      minWidth: 150,
      nowrap: true,
      className: 'col-hide-lg',
      render: (row) => <span className="small mono">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'status',
      title: '状态',
      minWidth: 140,
      render: (row) => (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Tag tone={STATUS_META[row.status]?.tone ?? 'muted'}>
            {STATUS_META[row.status]?.label ?? row.status}
          </Tag>
          {row.pinned && <Tag tone="gold">置顶</Tag>}
          {row.featured && <Tag tone="brand">精选</Tag>}
        </div>
      ),
    },
    {
      key: 'action',
      title: '操作',
      align: 'right',
      width: '330px',
      render: (row) => (
        <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button size="sm" variant="ghost" onClick={() => setPreview(row)}>
            查看
          </Button>
          {canAudit && row.status === 'PUBLISHED' && (
            <>
              <Button size="sm" variant="ghost" onClick={() => void toggleFlag(row, 'pinned')}>
                {row.pinned ? '取消置顶' : '置顶'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void toggleFlag(row, 'featured')}>
                {row.featured ? '取消精选' : '精选'}
              </Button>
            </>
          )}
          {canAudit && row.status !== 'PUBLISHED' && (
            <Button size="sm" variant="ghost" onClick={() => void audit(row, 'APPROVE')}>
              通过
            </Button>
          )}
          {canAudit && row.status !== 'REJECTED' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRejectNote('');
                setRejectTarget(row);
              }}
            >
              拒绝
            </Button>
          )}
          {canAudit && row.status !== 'HIDDEN' && (
            <Button size="sm" variant="ghost" onClick={() => void audit(row, 'HIDE')}>
              隐藏
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="圈子内容审核"
        desc="待审核内容来自先审后发配置，或机审命中风险的帖子；拒绝时需填写原因"
      />

      <Tabs
        items={STATUS_TABS.map((item) => ({
          ...item,
          count: data.counts[item.value || 'ALL'] ?? 0,
        }))}
        value={status}
        onChange={switchStatus}
      />

      <Card>
        <Toolbar>
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder="搜索正文或作者昵称"
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

        <DataTable
          columns={columns}
          rows={data.items}
          loading={loading}
          empty="暂无内容"
        />

        {data.total > PAGE_SIZE && (
          <Pagination
            page={page}
            total={data.total}
            pageSize={PAGE_SIZE}
            onChange={setPage}
          />
        )}
      </Card>

      <Modal
        open={Boolean(preview)}
        title="内容详情"
        wide
        onClose={() => setPreview(null)}
        footer={
          preview ? (
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              {canAudit && preview.status !== 'PUBLISHED' && (
                <Button loading={saving} onClick={() => void audit(preview, 'APPROVE')}>
                  通过并发布
                </Button>
              )}
              {canAudit && preview.status !== 'REJECTED' && (
                <Button
                  variant="plain"
                  onClick={() => {
                    setRejectNote('');
                    setRejectTarget(preview);
                    setPreview(null);
                  }}
                >
                  拒绝
                </Button>
              )}
              {canAudit && preview.status !== 'HIDDEN' && (
                <Button variant="plain" onClick={() => void audit(preview, 'HIDE')}>
                  隐藏
                </Button>
              )}
            </div>
          ) : null
        }
      >
        {preview && (
          <div>
            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <Tag tone={STATUS_META[preview.status]?.tone ?? 'muted'}>
                {STATUS_META[preview.status]?.label ?? preview.status}
              </Tag>
              <span className="small muted">
                {preview.author.nickname ?? '未设置昵称'} · {preview.category.name}
              </span>
              {preview.rewardedAt && <Tag tone="brand">已发积分</Tag>}
            </div>

            {preview.images.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                {preview.images.map((key) => (
                  <img
                    key={key}
                    src={assetPreviewUrl(key)}
                    alt="内容图片"
                    style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 10, objectFit: 'cover' }}
                  />
                ))}
              </div>
            )}

            <div
              style={{
                whiteSpace: 'pre-wrap',
                lineHeight: 1.7,
                marginBottom: 16,
                wordBreak: 'break-word',
              }}
            >
              {preview.content || '（无正文）'}
            </div>

            <KeyValue
              items={[
                { label: '提交时间', value: formatDate(preview.createdAt) },
                { label: '发布时间', value: preview.publishedAt ? formatDate(preview.publishedAt) : '未发布' },
                {
                  label: '话题',
                  value: preview.topics.length
                    ? preview.topics.map((topic) => `#${topic.name}`).join(' ')
                    : '无',
                },
                { label: '关联商品', value: preview.productCount ? `${preview.productCount} 个` : '无' },
                {
                  label: '互动数据',
                  value: `点赞 ${preview.likeCount} · 评论 ${preview.commentCount} · 收藏 ${preview.favoriteCount} · 浏览 ${preview.viewCount}`,
                },
                ...(preview.auditNote ? [{ label: '审核说明', value: preview.auditNote }] : []),
              ]}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(rejectTarget)}
        title="拒绝对话"
        onClose={() => setRejectTarget(null)}
        footer={
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="plain" onClick={() => setRejectTarget(null)}>
              取消
            </Button>
            <Button loading={saving} onClick={() => void submitReject()}>
              确认拒绝
            </Button>
          </div>
        }
      >
        <Field label="拒绝原因" required hint="会展示在作者的「我的圈子」中，便于修改后重新发布">
          <textarea
            className="textarea"
            rows={3}
            maxLength={200}
            value={rejectNote}
            placeholder="例如：图片与正文无关，请补充真实使用场景"
            onChange={(e) => setRejectNote(e.target.value)}
          />
        </Field>
      </Modal>
    </>
  );
}
