import { useEffect, useState } from 'react';

import { api, ApiError, formatDate } from '../api/client';
import { toast } from '../components/toast';
import { Card, PageHeader, Stat, Tag } from '../components/ui';

interface Stats {
  posts: Record<string, number>;
  comments: { total: number; hidden: number };
  likes: number;
  favorites: number;
  authors: number;
  pendingReports: number;
  today: { posts: number; comments: number };
  topPosts: {
    id: string;
    content: string;
    likeCount: number;
    commentCount: number;
    publishedAt: string | null;
    author: { id: string; nickname: string | null };
  }[];
  hotTopics: { id: string; name: string; postCount: number; enabled: boolean }[];
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '加载失败';
}

export default function CircleStats() {
  const [data, setData] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        setData(await api<Stats>('/admin/circle/stats'));
      } catch (err) {
        toast(errorText(err), 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <>
        <PageHeader title="圈子数据" />
        <div className="table-loading">加载中…</div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title="圈子数据" />
        <Card>暂无数据</Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="圈子数据"
        desc="内容供给、互动与治理概览；数据实时统计，含全部状态内容"
      />

      <div className="grid grid-4">
        <Stat
          label="内容总数"
          value={data.posts.ALL}
          hint={`已发布 ${data.posts.PUBLISHED} · 待审核 ${data.posts.PENDING}`}
        />
        <Stat label="发帖用户" value={data.authors} hint="发布过已通过内容的用户数" />
        <Stat label="今日新增" value={data.today.posts} hint={`评论 ${data.today.comments} 条`} />
        <Stat
          label="待处理举报"
          value={data.pendingReports}
          tone={data.pendingReports > 0 ? 'warn' : 'default'}
          hint={`已拒绝 ${data.posts.REJECTED} · 已隐藏 ${data.posts.HIDDEN}`}
        />
      </div>

      <div className="grid grid-4">
        <Stat label="点赞总数" value={data.likes} />
        <Stat label="收藏总数" value={data.favorites} />
        <Stat
          label="评论总数"
          value={data.comments.total}
          hint={data.comments.hidden ? `其中已隐藏 ${data.comments.hidden}` : '暂无隐藏评论'}
        />
        <Stat label="审核通过率" value={rate(data)} hint="已发布 / 内容总数" />
      </div>

      <div className="grid grid-2">
        <Card title="热门内容 Top 5">
          {data.topPosts.length === 0 ? (
            <div className="empty">暂无已发布内容</div>
          ) : (
            <div className="col" style={{ gap: 12 }}>
              {data.topPosts.map((post, index) => (
                <div key={post.id} className="row" style={{ gap: 10 }}>
                  <span className="tag tag-muted">{index + 1}</span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="cell-clip">{post.content || '（无正文）'}</div>
                    <div className="small muted">
                      {post.author.nickname ?? '未设置昵称'} · 点赞 {post.likeCount} · 评论{' '}
                      {post.commentCount} · {formatDate(post.publishedAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="热门话题 Top 5">
          {data.hotTopics.length === 0 ? (
            <div className="empty">暂无话题</div>
          ) : (
            <div className="col" style={{ gap: 12 }}>
              {data.hotTopics.map((topic, index) => (
                <div key={topic.id} className="row-between">
                  <div className="row" style={{ gap: 10 }}>
                    <span className="tag tag-muted">{index + 1}</span>
                    <span>{topic.name}</span>
                    {!topic.enabled && <Tag tone="muted">停用</Tag>}
                  </div>
                  <span className="small muted">内容 {topic.postCount}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function rate(data: Stats): string {
  if (!data.posts.ALL) return '—';
  const value = Math.round((data.posts.PUBLISHED / data.posts.ALL) * 100);
  return `${value}%`;
}
