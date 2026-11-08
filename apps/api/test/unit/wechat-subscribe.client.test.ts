import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearSubscribeTokenCache,
  WechatSubscribeClient,
} from '../../src/modules/notification/wechat-subscribe.client';

const creds = { appId: 'wx_test_app', appSecret: 'secret' };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function input() {
  return {
    openid: 'openid_1',
    templateId: 'tpl_1',
    page: '/pages/order-detail/index?id=1',
    data: { character_string1: { value: 'SN001' } },
  };
}

describe('WechatSubscribeClient', () => {
  beforeEach(() => {
    clearSubscribeTokenCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('access_token 复用缓存，两次发送只取一次 token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token_1', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok', msgid: 'm1' }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok', msgid: 'm2' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new WechatSubscribeClient(creds);
    expect((await client.send(input())).ok).toBe(true);
    expect((await client.send(input())).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('token 失效（40001）时清缓存并重试一次', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token_old', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 40001, errmsg: 'invalid credential' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token_new', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok', msgid: 'm3' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new WechatSubscribeClient(creds);
    const result = await client.send(input());
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('业务错误码原样返回，不抛异常', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token_1', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 47003, errmsg: 'argument invalid' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new WechatSubscribeClient(creds);
    const result = await client.send(input());
    expect(result).toMatchObject({ ok: false, errcode: 47003, errmsg: 'argument invalid' });
  });
});
