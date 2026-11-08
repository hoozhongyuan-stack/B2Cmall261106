import { BadGatewayException } from '@nestjs/common';

/** 微信订阅消息接口：access_token 缓存 + 一次性订阅消息发送 */
const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/stable_token';
const SEND_URL = 'https://api.weixin.qq.com/cgi-bin/message/subscribe/send';
/** access_token 提前 5 分钟过期，避免临界失效 */
const TOKEN_SAFETY_MS = 5 * 60 * 1000;

interface TokenCacheItem {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCacheItem>();

/** 测试辅助：清空模块级 access_token 缓存 */
export function clearSubscribeTokenCache(): void {
  tokenCache.clear();
}

export interface SubscribeCredentials {
  appId: string;
  appSecret: string;
}

export interface SubscribeSendInput {
  openid: string;
  templateId: string;
  page?: string;
  data: Record<string, { value: string }>;
  miniprogramState?: 'formal' | 'trial' | 'developer';
}

export interface SubscribeSendResult {
  ok: boolean;
  errcode?: number;
  errmsg?: string;
  raw: unknown;
}

interface WechatApiResponse {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
  msgid?: string;
}

export class WechatSubscribeClient {
  constructor(private readonly creds: SubscribeCredentials) {}

  async send(input: SubscribeSendInput): Promise<SubscribeSendResult> {
    let token = await this.accessToken();
    let payload = await this.post(token, input);

    // token 失效：清缓存后重试一次
    if (payload.errcode === 40001 || payload.errcode === 42001) {
      tokenCache.delete(this.creds.appId);
      token = await this.accessToken();
      payload = await this.post(token, input);
    }

    if (payload.errcode && payload.errcode !== 0) {
      return {
        ok: false,
        errcode: payload.errcode,
        errmsg: payload.errmsg ?? '微信订阅消息发送失败',
        raw: payload,
      };
    }
    return { ok: true, raw: payload };
  }

  private async accessToken(): Promise<string> {
    const { appId, appSecret } = this.creds;
    if (!appId || !appSecret) {
      throw new BadGatewayException('订阅消息未配置小程序 AppID / AppSecret');
    }

    const cached = tokenCache.get(appId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credential',
        appid: appId,
        secret: appSecret,
        force_refresh: false,
      }),
    });
    const text = await res.text();
    const body = this.parse(text);
    if (!res.ok || !body.access_token) {
      throw new BadGatewayException(
        `获取微信 access_token 失败（${res.status}）：${[body.errcode, body.errmsg]
          .filter(Boolean)
          .join(' ') || text || '无响应体'}`,
      );
    }

    const expiresIn = Number(body.expires_in ?? 7200) * 1000;
    tokenCache.set(appId, {
      token: body.access_token,
      expiresAt: Date.now() + Math.max(expiresIn - TOKEN_SAFETY_MS, 60_000),
    });
    return body.access_token;
  }

  private async post(token: string, input: SubscribeSendInput): Promise<WechatApiResponse> {
    const res = await fetch(`${SEND_URL}?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        touser: input.openid,
        template_id: input.templateId,
        ...(input.page ? { page: input.page } : {}),
        data: input.data,
        ...(input.miniprogramState ? { miniprogram_state: input.miniprogramState } : {}),
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new BadGatewayException(
        `微信订阅消息接口失败（${res.status}）：${text || '无响应体'}`,
      );
    }
    return this.parse(text);
  }

  private parse(text: string): WechatApiResponse {
    if (!text) return {};
    try {
      return JSON.parse(text) as WechatApiResponse;
    } catch {
      throw new BadGatewayException('微信订阅消息接口返回非 JSON');
    }
  }
}
