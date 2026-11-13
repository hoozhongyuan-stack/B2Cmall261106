/**
 * 圈子消费与治理契约：信息流、点赞收藏、评论回复、关注、举报自动隐藏、互动消息。
 */
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

interface Session {
  token: string;
  id: string;
}

let prisma: PrismaClient;
let author: Session;
let fan1: Session;
let fan2: Session;
let fan3: Session;
let adminToken = '';
let categoryId = '';
let postId = '';
let rootCommentId = '';
let replyCommentId = '';

async function api(path: string, init: RequestInit = {}, token = '') {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** 直接用数据库建用户并签发令牌，避免 /auth/wechat-login 的限流影响其它用例 */
async function createUser(jwt: JwtService, label: string, stamp: number): Promise<Session> {
  const user = await prisma.user.create({
    data: { openid: `dev_circle_m3_${label}_${stamp}`, nickname: `M3${label}` },
    select: { id: true },
  });
  return {
    id: user.id,
    token: jwt.sign({ sub: user.id, scope: 'miniapp' }, { expiresIn: '1h' }),
  };
}

beforeAll(async () => {
  prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
  const jwt = new JwtService({ secret: process.env.JWT_SECRET ?? 'dev-secret-change-me' });
  const stamp = Date.now();
  author = await createUser(jwt, 'author', stamp);
  fan1 = await createUser(jwt, 'fan1', stamp);
  fan2 = await createUser(jwt, 'fan2', stamp);
  fan3 = await createUser(jwt, 'fan3', stamp);

  const admin = await api('/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account: 'admin@shanye.com', password: 'admin123' }),
  });
  adminToken = admin.body.data.token;

  const categories = await api('/circle/categories');
  categoryId = categories.body.data.items[0].id;

  const created = await api(
    '/circle/posts',
    {
      method: 'POST',
      body: JSON.stringify({ content: 'M3 契约内容：一起去山里走走', categoryId }),
    },
    author.token,
  );
  expect(created.status).toBe(201);
  postId = created.body.data.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('圈子信息流、互动与治理', () => {
  it('信息流与详情返回互动状态', async () => {
    const feed = await api(`/circle/posts?tab=latest&categoryId=${categoryId}`);
    expect(feed.status).toBe(200);
    expect(feed.body.data.items.some((item: { id: string }) => item.id === postId)).toBe(true);

    const detail = await api(`/circle/posts/${postId}`, {}, fan1.token);
    expect(detail.status).toBe(200);
    expect(detail.body.data.liked).toBe(false);
    expect(detail.body.data.favorited).toBe(false);
    expect(detail.body.data.author.id).toBeTruthy();
    author.id = detail.body.data.author.id;
  });

  it('点赞与收藏幂等，计数与状态一致', async () => {
    const first = await api(`/circle/posts/${postId}/like`, { method: 'POST' }, fan1.token);
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ liked: true, likeCount: 1 });

    const again = await api(`/circle/posts/${postId}/like`, { method: 'POST' }, fan1.token);
    expect(again.body.data.likeCount).toBe(1);

    const detail = await api(`/circle/posts/${postId}`, {}, fan1.token);
    expect(detail.body.data.liked).toBe(true);
    expect(detail.body.data.likeCount).toBe(1);

    const favorite = await api(`/circle/posts/${postId}/favorite`, { method: 'POST' }, fan1.token);
    expect(favorite.body.data).toMatchObject({ favorited: true, favoriteCount: 1 });

    const mine = await api('/circle/me/favorites', {}, fan1.token);
    expect(mine.body.data.items.some((item: { id: string }) => item.id === postId)).toBe(true);
  });

  it('评论、回复与敏感词拦截', async () => {
    const risky = await api(
      '/circle/comments',
      { method: 'POST', body: JSON.stringify({ postId, content: '加我微信，带你刷单' }) },
      fan1.token,
    );
    expect(risky.status).toBe(400);

    const root = await api(
      '/circle/comments',
      { method: 'POST', body: JSON.stringify({ postId, content: '这地方真不错' }) },
      fan1.token,
    );
    expect(root.status).toBe(201);
    rootCommentId = root.body.data.id;

    const reply = await api(
      '/circle/comments',
      {
        method: 'POST',
        body: JSON.stringify({ postId, content: '下次一起去', parentId: rootCommentId }),
      },
      author.token,
    );
    expect(reply.status).toBe(201);
    replyCommentId = reply.body.data.id;

    const list = await api(`/circle/posts/${postId}/comments`);
    expect(list.body.data.total).toBe(2);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0].replies).toHaveLength(1);
  });

  it('作者收到点赞与评论消息，未读数可清零', async () => {
    const notifications = await api('/circle/notifications', {}, author.token);
    expect(notifications.status).toBe(200);
    expect(notifications.body.data.unread).toBeGreaterThanOrEqual(2);
    const types = notifications.body.data.items.map((item: { type: string }) => item.type);
    expect(types).toContain('LIKE');
    expect(types).toContain('COMMENT');

    const read = await api(
      '/circle/notifications/read',
      { method: 'POST', body: JSON.stringify({ all: true }) },
      author.token,
    );
    expect(read.status).toBe(201);
    const after = await api('/circle/notifications', {}, author.token);
    expect(after.body.data.unread).toBe(0);
  });

  it('关注与用户主页', async () => {
    const follow = await api(`/circle/users/${author.id}/follow`, { method: 'POST' }, fan1.token);
    expect(follow.status).toBe(201);

    const profile = await api(`/circle/users/${author.id}`, {}, fan1.token);
    expect(profile.body.data.isFollowing).toBe(true);
    expect(profile.body.data.followerCount).toBe(1);

    const followFeed = await api('/circle/posts?tab=follow', {}, fan1.token);
    expect(followFeed.body.data.items.some((item: { id: string }) => item.id === postId)).toBe(
      true,
    );
  });

  it('删除自己的评论后计数回退', async () => {
    const removed = await api(`/circle/comments/${rootCommentId}`, { method: 'DELETE' }, fan1.token);
    expect(removed.status).toBe(200);
    const list = await api(`/circle/posts/${postId}/comments`);
    expect(list.body.data.total).toBe(1);
  });

  it('圈子搜索命中正文，空关键词返回空', async () => {
    const hit = await api(`/circle/search?keyword=${encodeURIComponent('M3 契约内容')}`);
    expect(hit.status).toBe(200);
    expect(hit.body.data.items.some((item: { id: string }) => item.id === postId)).toBe(true);

    const miss = await api(`/circle/search?keyword=${encodeURIComponent('不存在的内容xyz')}`);
    expect(miss.status).toBe(200);
    expect(miss.body.data.items).toHaveLength(0);

    const empty = await api('/circle/search?keyword=');
    expect(empty.status).toBe(200);
    expect(empty.body.data.items).toHaveLength(0);
  });

  it('后台数据看板与置顶、评论管理可用', async () => {
    const stats = await api('/admin/circle/stats', {}, adminToken);
    expect(stats.status).toBe(200);
    expect(stats.body.data.posts.PUBLISHED).toBeGreaterThanOrEqual(1);
    expect(stats.body.data.likes).toBeGreaterThanOrEqual(1);
    expect(stats.body.data.comments.total).toBeGreaterThanOrEqual(1);
    expect(stats.body.data.today.posts).toBeGreaterThanOrEqual(1);

    const pinned = await api(
      `/admin/circle/posts/${postId}/flags`,
      { method: 'PATCH', body: JSON.stringify({ pinned: true, featured: true }) },
      adminToken,
    );
    expect(pinned.status).toBe(200);
    expect(pinned.body.data.pinned).toBe(true);
    expect(pinned.body.data.featured).toBe(true);

    const list = await api('/admin/circle/comments?hidden=false', {}, adminToken);
    expect(list.status).toBe(200);
    expect(list.body.data.items.some((item: { id: string }) => item.id === replyCommentId)).toBe(
      true,
    );

    const hide = await api(
      `/admin/circle/comments/${replyCommentId}`,
      { method: 'PATCH', body: JSON.stringify({ hidden: true }) },
      adminToken,
    );
    expect(hide.status).toBe(200);

    const afterHide = await api(`/circle/posts/${postId}/comments`);
    expect(afterHide.body.data.total).toBe(0);

    const show = await api(
      `/admin/circle/comments/${replyCommentId}`,
      { method: 'PATCH', body: JSON.stringify({ hidden: false }) },
      adminToken,
    );
    expect(show.status).toBe(200);
    const afterShow = await api(`/circle/posts/${postId}/comments`);
    expect(afterShow.body.data.total).toBe(1);
  });

  it('重复举报拦截，3 次举报自动隐藏', async () => {
    const report = (token: string) =>
      api(
        '/circle/reports',
        {
          method: 'POST',
          body: JSON.stringify({ targetType: 'POST', targetId: postId, reason: '广告引流' }),
        },
        token,
      );

    const first = await report(fan1.token);
    expect(first.status).toBe(201);
    const duplicate = await report(fan1.token);
    expect(duplicate.status).toBe(409);

    await report(fan2.token);
    const third = await report(fan3.token);
    expect(third.status).toBe(201);

    const detail = await api(`/circle/posts/${postId}`, {}, author.token);
    expect(detail.body.data.status).toBe('HIDDEN');

    const feed = await api(`/circle/posts?tab=latest&categoryId=${categoryId}`);
    expect(feed.body.data.items.some((item: { id: string }) => item.id === postId)).toBe(false);
  });

  it('后台可查看并驳回举报', async () => {
    const list = await api('/admin/circle/reports?status=PENDING', {}, adminToken);
    expect(list.status).toBe(200);
    expect(list.body.data.counts.PENDING).toBeGreaterThanOrEqual(3);
    const row = list.body.data.items.find((item: { targetId: string }) => item.targetId === postId);
    expect(row.target.content).toContain('M3 契约内容');

    const handled = await api(
      `/admin/circle/reports/${row.id}`,
      { method: 'PATCH', body: JSON.stringify({ action: 'DISMISS' }) },
      adminToken,
    );
    expect(handled.status).toBe(200);

    const again = await api(
      `/admin/circle/reports/${row.id}`,
      { method: 'PATCH', body: JSON.stringify({ action: 'DISMISS' }) },
      adminToken,
    );
    expect(again.status).toBe(400);
  });
});
