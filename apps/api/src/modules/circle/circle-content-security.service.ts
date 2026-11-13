import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { IntegrationService } from '../integration/integration.service';

const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/stable_token';
const MSG_SEC_URL = 'https://api.weixin.qq.com/wxa/msg_sec_check';
const TOKEN_SAFETY_MS = 5 * 60 * 1000;

/** 本地兜底词库：命中直接进入待审，不依赖微信接口 */
const DEFAULT_BANNED_WORDS = [
  '赌博',
  '博彩',
  '毒品',
  '枪支',
  '代开发票',
  '办证',
  '裸聊',
  '刷单',
  '套现',
  '私加微信',
  '加我微信',
];

interface TokenCacheItem {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCacheItem>();

export interface ContentCheckResult {
  risky: boolean;
  note?: string;
}

/**
 * 圈子内容安全：
 * 1. 本地敏感词优先拦截，命中即进入人工审核；
 * 2. 配置了小程序 AppID/Secret 时调用微信 msgSecCheck；
 * 3. 微信接口异常时放行并记录日志，避免因第三方故障阻断发帖。
 */
@Injectable()
export class CircleContentSecurityService {
  private readonly logger = new Logger(CircleContentSecurityService.name);

  constructor(
    private readonly integration: IntegrationService,
    private readonly config: ConfigService,
  ) {}

  async checkText(content: string, openid: string | null): Promise<ContentCheckResult> {
    const hit = this.bannedWord(content);
    if (hit) return { risky: true, note: `命中敏感词「${hit}」` };

    const creds = await this.integration.miniappCredentials();
    if (!creds.appId || !creds.appSecret || !openid || openid.startsWith('dev')) {
      return { risky: false };
    }

    try {
      const token = await this.accessToken(creds.appId, creds.appSecret);
      const res = await fetch(`${MSG_SEC_URL}?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, version: 2, scene: 3, openid }),
      });
      const body = (await res.json()) as { errcode?: number; errmsg?: string };
      if (body.errcode === 87014) {
        return { risky: true, note: '微信内容安全检测未通过' };
      }
      if (body.errcode && body.errcode !== 0) {
        this.logger.warn(`msgSecCheck 返回异常：${body.errcode} ${body.errmsg ?? ''}`);
      }
      return { risky: false };
    } catch (err) {
      this.logger.warn(`内容安全接口调用失败，按放行处理：${(err as Error).message}`);
      return { risky: false };
    }
  }

  private bannedWord(content: string): string | null {
    const extra = (this.config.get<string>('CIRCLE_BANNED_WORDS') ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const words = [...DEFAULT_BANNED_WORDS, ...extra];
    return words.find((word) => content.includes(word)) ?? null;
  }

  private async accessToken(appId: string, appSecret: string): Promise<string> {
    const cached = tokenCache.get(appId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credential', appid: appId, secret: appSecret }),
    });
    const body = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    };
    if (!res.ok || !body.access_token) {
      throw new Error(`获取 access_token 失败（${res.status}）：${body.errcode ?? ''} ${body.errmsg ?? ''}`);
    }
    tokenCache.set(appId, {
      token: body.access_token,
      expiresAt: Date.now() + Math.max((body.expires_in ?? 7200) * 1000 - TOKEN_SAFETY_MS, 60_000),
    });
    return body.access_token;
  }
}
