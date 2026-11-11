/**
 * 积分体系契约：规则配置、签到连签、分享次数上限。
 * 不做积分抵扣，只校验发放口径。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { AGREEMENT_VERSIONS } from '@shanye/shared';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

let userToken = '';
let adminTokenValue = '';

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
      code: 'seed_user',
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
  adminTokenValue = admin.body.data.token;
});

describe('积分规则与发放', () => {
  it('保存配置并对签到、分享按规则发放', async () => {
    const defaults = await api('/admin/points-config', {}, adminTokenValue);
    expect(defaults.status).toBe(200);

    const saved = await api(
      '/admin/points-config',
      {
        method: 'PUT',
        body: JSON.stringify({
          yuanPerPoint: 2,
          signInPoints: 5,
          signInStreakDays: 2,
          signInStreakBonusType: 'POINTS',
          signInStreakBonusPoints: 10,
          sharePoints: 3,
          shareDailyLimit: 2,
        }),
      },
      adminTokenValue,
    );
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({
      yuanPerPoint: 2,
      signInPoints: 5,
      signInStreakDays: 2,
      sharePoints: 3,
      shareDailyLimit: 2,
    });

    const overview = await api('/member/points/overview', {}, userToken);
    expect(overview.status).toBe(200);
    expect(overview.body.data.signIn.signedToday).toBe(false);
    expect(overview.body.data.share.limit).toBe(2);

    const first = await api('/member/points/sign-in', { method: 'POST' }, userToken);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ points: 5, streak: 1, bonusPoints: 0 });

    const again = await api('/member/points/sign-in', { method: 'POST' }, userToken);
    expect(again.status).toBe(409);

    const share1 = await api('/member/points/share', { method: 'POST' }, userToken);
    expect(share1.status).toBe(200);
    expect(share1.body.data).toMatchObject({ awarded: true, points: 3, todayCount: 1 });

    const share2 = await api('/member/points/share', { method: 'POST' }, userToken);
    expect(share2.body.data.todayCount).toBe(2);

    const share3 = await api('/member/points/share', { method: 'POST' }, userToken);
    expect(share3.body.data.awarded).toBe(false);
    expect(share3.body.data.reason).toContain('上限');
  });

  it('非法配置返回 400；连续奖励选券时必须指定有效券', async () => {
    const zero = await api(
      '/admin/points-config',
      { method: 'PUT', body: JSON.stringify({ yuanPerPoint: 0 }) },
      adminTokenValue,
    );
    expect(zero.status).toBe(400);

    const couponMissing = await api(
      '/admin/points-config',
      {
        method: 'PUT',
        body: JSON.stringify({
          signInStreakDays: 3,
          signInStreakBonusType: 'COUPON',
          signInStreakCouponId: null,
        }),
      },
      adminTokenValue,
    );
    expect(couponMissing.status).toBe(400);
  });
});
