/**
 * 圈子会员发帖与审核契约：类目/话题、内容安全、状态流转、积分发放与话题计数。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { AGREEMENT_VERSIONS } from '@shanye/shared';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

let userToken = '';
let adminToken = '';
let categoryId = '';
let topicId = '';
let topicName = '';
let publishedPostId = '';
let riskyPostId = '';
let expectedPoints = 0;

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

beforeAll(async () => {
  const login = await api('/auth/wechat-login', {
    method: 'POST',
    body: JSON.stringify({
      code: `circle_contract_${Date.now()}`,
      agreed: true,
      agreementVersion: AGREEMENT_VERSIONS.terms,
      privacyVersion: AGREEMENT_VERSIONS.privacy,
    }),
  });
  userToken = login.body.data.token;

  const admin = await api(
    '/admin/auth/login',
    { method: 'POST', body: JSON.stringify({ account: 'admin@shanye.com', password: 'admin123' }) },
  );
  adminToken = admin.body.data.token;

  const categories = await api('/circle/categories');
  categoryId = categories.body.data.items[0].id;

  const settings = await api('/admin/circle/settings', {}, adminToken);
  const { postPoints, postPointsDailyLimit } = settings.body.data;
  expectedPoints = postPoints > 0 && postPointsDailyLimit !== 0 ? postPoints : 0;

  const topic = await api(
    '/admin/circle/topics',
    { method: 'POST', body: JSON.stringify({ name: `契约话题${Date.now()}`, categoryId }) },
    adminToken,
  );
  topicId = topic.body.data.id;
  topicName = topic.body.data.name;
});

describe('圈子会员发帖与审核', () => {
  it('可获取启用类目与进行中话题', async () => {
    const categories = await api('/circle/categories');
    expect(categories.status).toBe(200);
    expect(categories.body.data.enabled).toBe(true);
    expect(categories.body.data.items.length).toBeGreaterThan(0);

    const topics = await api(`/circle/topics?categoryId=${categoryId}`);
    expect(topics.status).toBe(200);
    expect(topics.body.data.items.some((item: { id: string }) => item.id === topicId)).toBe(true);
  });

  it('未登录不能发帖', async () => {
    const res = await api('/circle/posts', {
      method: 'POST',
      body: JSON.stringify({ content: '未登录', categoryId }),
    });
    expect(res.status).toBe(401);
  });

  it('空内容与非法类目被拒绝', async () => {
    const empty = await api(
      '/circle/posts',
      { method: 'POST', body: JSON.stringify({ content: '  ', categoryId }) },
      userToken,
    );
    expect(empty.status).toBe(400);

    const badCategory = await api(
      '/circle/posts',
      {
        method: 'POST',
        body: JSON.stringify({ content: '类目不存在', categoryId: 'not-exist' }),
      },
      userToken,
    );
    expect(badCategory.status).toBe(400);
  });

  it('正常内容直接发布并发放积分、累加话题数', async () => {
    const res = await api(
      '/circle/posts',
      {
        method: 'POST',
        body: JSON.stringify({
          content: '周末去山里露营，带上了新买的茶具',
          categoryId,
          topicIds: [topicId],
        }),
      },
      userToken,
    );
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PUBLISHED');
    expect(res.body.data.points).toBe(expectedPoints);
    publishedPostId = res.body.data.id;

    const topics = await api(`/admin/circle/topics`, {}, adminToken);
    const row = topics.body.data.items.find((item: { id: string }) => item.id === topicId);
    expect(row.postCount).toBe(1);

    const mine = await api('/circle/me/posts', {}, userToken);
    expect(mine.status).toBe(200);
    expect(mine.body.data.items.some((item: { id: string }) => item.id === publishedPostId)).toBe(
      true,
    );
  });

  it('命中敏感词进入待审，不发放积分', async () => {
    const res = await api(
      '/circle/posts',
      {
        method: 'POST',
        body: JSON.stringify({ content: '这里有赌博链接，私加微信', categoryId }),
      },
      userToken,
    );
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.points).toBe(0);
    riskyPostId = res.body.data.id;

    const mine = await api('/circle/me/posts?status=PENDING', {}, userToken);
    const row = mine.body.data.items.find((item: { id: string }) => item.id === riskyPostId);
    expect(row.auditNote).toContain('敏感词');
  });

  it('后台审核队列带状态计数并可拒绝、通过', async () => {
    const pending = await api('/admin/circle/posts?status=PENDING', {}, adminToken);
    expect(pending.status).toBe(200);
    expect(pending.body.data.counts.PENDING).toBeGreaterThan(0);
    expect(pending.body.data.items.some((item: { id: string }) => item.id === riskyPostId)).toBe(
      true,
    );

    const noNote = await api(
      `/admin/circle/posts/${riskyPostId}/audit`,
      { method: 'PATCH', body: JSON.stringify({ action: 'REJECT' }) },
      adminToken,
    );
    expect(noNote.status).toBe(400);

    const rejected = await api(
      `/admin/circle/posts/${riskyPostId}/audit`,
      { method: 'PATCH', body: JSON.stringify({ action: 'REJECT', note: '含违规引流信息' }) },
      adminToken,
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('REJECTED');

    const mine = await api('/circle/me/posts?status=REJECTED', {}, userToken);
    const row = mine.body.data.items.find((item: { id: string }) => item.id === riskyPostId);
    expect(row.auditNote).toBe('含违规引流信息');

    const approved = await api(
      `/admin/circle/posts/${riskyPostId}/audit`,
      { method: 'PATCH', body: JSON.stringify({ action: 'APPROVE' }) },
      adminToken,
    );
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('PUBLISHED');
    // 当日积分上限已用完（默认每天 1 条），补审不再发放
    expect(approved.body.data.points).toBe(0);
  });

  it('隐藏已发布内容会回退话题计数', async () => {
    const hidden = await api(
      `/admin/circle/posts/${publishedPostId}/audit`,
      { method: 'PATCH', body: JSON.stringify({ action: 'HIDE', note: '契约测试隐藏' }) },
      adminToken,
    );
    expect(hidden.status).toBe(200);
    expect(hidden.body.data.status).toBe('HIDDEN');

    const topics = await api('/admin/circle/topics', {}, adminToken);
    const row = topics.body.data.items.find((item: { id: string }) => item.id === topicId);
    expect(row.postCount).toBe(0);
  });

  it('话题有历史内容时禁止删除，可停用', async () => {
    const removed = await api(`/admin/circle/topics/${topicId}`, { method: 'DELETE' }, adminToken);
    expect(removed.status).toBe(400);

    const disabled = await api(
      `/admin/circle/topics/${topicId}`,
      { method: 'PATCH', body: JSON.stringify({ name: topicName, enabled: false }) },
      adminToken,
    );
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.enabled).toBe(false);
  });
});
