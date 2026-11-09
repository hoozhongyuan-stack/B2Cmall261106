/**
 * 小程序登录协议契约：首登必须勾选、版本校验、同意留痕与静默续期。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGREEMENT_VERSIONS } from '@shanye/shared';
import { PrismaClient } from '@prisma/client';

const PORT = Number(process.env.CONTRACT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}/api`;

let prisma: PrismaClient | null = null;

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function login(body: Record<string, unknown>) {
  return api('/auth/wechat-login', { method: 'POST', body: JSON.stringify(body) });
}

beforeAll(() => {
  prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });
});

afterAll(async () => {
  await prisma?.$disconnect();
  prisma = null;
});

describe('小程序登录协议', () => {
  it('首次登录必须勾选协议，版本不符同样拒绝', async () => {
    const code = `consent-missing-${Date.now()}`;

    const noAgree = await login({ code });
    expect(noAgree.status).toBe(400);
    expect(noAgree.body.message).toContain('协议');
    expect(noAgree.body.data).toBeNull();

    const badVersion = await login({
      code,
      agreed: true,
      agreementVersion: '2000-01-01',
      privacyVersion: AGREEMENT_VERSIONS.privacy,
    });
    expect(badVersion.status).toBe(400);

    const noPrivacy = await login({
      code,
      agreed: true,
      agreementVersion: AGREEMENT_VERSIONS.terms,
    });
    expect(noPrivacy.status).toBe(400);
  });

  it('勾选后签发 token 并写入两条同意记录，之后可静默续期', async () => {
    const code = `consent-ok-${Date.now()}`;

    const ok = await login({
      code,
      agreed: true,
      agreementVersion: AGREEMENT_VERSIONS.terms,
      privacyVersion: AGREEMENT_VERSIONS.privacy,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.token).toBeTruthy();
    expect(ok.body.data.agreements).toEqual(AGREEMENT_VERSIONS);

    const consents = await prisma!.userConsent.findMany({
      where: { userId: ok.body.data.user.id },
      select: { type: true, version: true },
      orderBy: { type: 'asc' },
    });
    expect(consents).toEqual([
      { type: 'PRIVACY', version: AGREEMENT_VERSIONS.privacy },
      { type: 'USER_AGREEMENT', version: AGREEMENT_VERSIONS.terms },
    ]);

    // 已同意当前版本 → 静默续期不再要求 agreed
    const silent = await login({ code });
    expect(silent.status).toBe(200);
    expect(silent.body.data.token).toBeTruthy();
  });

  it('协议升级后（仅有旧版本同意记录）必须重新确认', async () => {
    const code = `consent-upgrade-${Date.now()}`;
    const first = await login({
      code,
      agreed: true,
      agreementVersion: AGREEMENT_VERSIONS.terms,
      privacyVersion: AGREEMENT_VERSIONS.privacy,
    });
    expect(first.status).toBe(200);
    const userId = first.body.data.user.id as string;

    // 模拟版本升级：把当前版本记录改为旧版本
    await prisma!.userConsent.updateMany({
      where: { userId },
      data: { version: '2000-01-01' },
    });

    const stale = await login({ code });
    expect(stale.status).toBe(400);
    expect(stale.body.message).toContain('协议');

    const renewed = await login({
      code,
      agreed: true,
      agreementVersion: AGREEMENT_VERSIONS.terms,
      privacyVersion: AGREEMENT_VERSIONS.privacy,
    });
    expect(renewed.status).toBe(200);
    const versions = await prisma!.userConsent.findMany({
      where: { userId, version: { in: [AGREEMENT_VERSIONS.terms, '2000-01-01'] } },
      select: { version: true },
      distinct: ['version'],
    });
    expect(versions.map((row) => row.version)).toEqual(
      expect.arrayContaining([AGREEMENT_VERSIONS.terms, '2000-01-01']),
    );
  });
});
