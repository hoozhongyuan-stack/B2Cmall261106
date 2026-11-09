import Taro from '@tarojs/taro';
import { AGREEMENT_VERSIONS } from '@shanye/shared/src/agreements';
import type { ApiEnvelope } from '@shanye/api-types';

const TOKEN_KEY = 'shanye_token';
const CONSENT_KEY = 'shanye_consent';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 需要登录但本地没有可用凭证：由页面跳登录，不做错误提示 */
export class NeedLoginError extends Error {
  constructor() {
    super('请先登录');
    this.name = 'NeedLoginError';
  }
}

export function getToken(): string {
  return Taro.getStorageSync<string>(TOKEN_KEY) || '';
}

export function setToken(token: string): void {
  Taro.setStorageSync(TOKEN_KEY, token);
}

export function clearToken(): void {
  Taro.removeStorageSync(TOKEN_KEY);
}

interface ConsentCache {
  terms: string;
  privacy: string;
}

/** 本地协议版本：与服务端当前版本一致时，才允许静默登录 */
export function hasCurrentConsent(): boolean {
  const cached = Taro.getStorageSync<ConsentCache | ''>(CONSENT_KEY);
  return Boolean(
    cached &&
      typeof cached === 'object' &&
      cached.terms === AGREEMENT_VERSIONS.terms &&
      cached.privacy === AGREEMENT_VERSIONS.privacy,
  );
}

export function saveConsent(): void {
  Taro.setStorageSync(CONSENT_KEY, {
    terms: AGREEMENT_VERSIONS.terms,
    privacy: AGREEMENT_VERSIONS.privacy,
  });
}

export function clearConsent(): void {
  Taro.removeStorageSync(CONSENT_KEY);
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: Method;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  /** required：需登录页面；optional：公开页面，未登录时匿名请求 */
  auth?: 'required' | 'optional';
}

async function raw<T>(path: string, options: RequestOptions, auth: boolean): Promise<T> {
  const query = Object.entries(options.query ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');

  const res = await Taro.request({
    url: `${API_BASE}${path}${query ? `?${query}` : ''}`,
    method: (options.method ?? 'GET') as never,
    data: options.body as never,
    header: {
      'content-type': 'application/json',
      ...(auth && getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  const payload = res.data as ApiEnvelope<T> | undefined;
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new ApiError(payload?.code ?? 'HTTP_ERROR', payload?.message ?? '请求失败', res.statusCode);
  }
  return (payload?.data ?? (null as T)) as T;
}

/**
 * 登录 code：真机用 Taro.login() 获取，H5 预览沿用固定 code。
 * 后端未上传 AppSecret 时会把 code 派生为稳定 openid，便于本地联调。
 */
async function loginCode(): Promise<string> {
  if (process.env.TARO_ENV === 'weapp') {
    const result = await Taro.login();
    if (result.code) return result.code;
  }
  return 'dev_miniapp_user';
}

let loginTask: Promise<void> | null = null;

/** 显式登录（登录页勾选协议后）；静默续期不传 agreed */
export async function loginWithWechat(options: { agreed?: boolean } = {}): Promise<void> {
  const code = await loginCode();
  const body = options.agreed
    ? {
        code,
        agreed: true,
        agreementVersion: AGREEMENT_VERSIONS.terms,
        privacyVersion: AGREEMENT_VERSIONS.privacy,
      }
    : { code };
  const data = await raw<{ token: string }>(
    '/auth/wechat-login',
    { method: 'POST', body },
    false,
  );
  setToken(data.token);
}

/**
 * 静默登录：仅当本地同意过当前版本协议时执行。
 * 未同意 / 协议已升级 / 服务端要求重新同意 → 抛 NeedLoginError，由页面跳登录。
 */
export function ensureLogin(): Promise<void> {
  if (getToken()) return Promise.resolve();
  if (!hasCurrentConsent()) return Promise.reject(new NeedLoginError());
  if (loginTask) return loginTask;

  loginTask = loginWithWechat()
    .catch((err) => {
      if (err instanceof ApiError && err.status === 400 && err.message.includes('协议')) {
        clearConsent();
        throw new NeedLoginError();
      }
      throw err;
    })
    .finally(() => {
      loginTask = null;
    });
  return loginTask;
}

let redirecting = false;

/** 跳登录页并带上回跳地址；已在登录页时不重复跳转 */
export function redirectToLogin(): void {
  if (redirecting) return;
  const pages = Taro.getCurrentPages() as unknown as {
    route: string;
    options?: Record<string, string>;
  }[];
  const current = pages[pages.length - 1];
  const routeName = (current?.route ?? '').replace(/^\//, '');
  if (routeName === 'pages/login/index') return;

  const route = routeName || 'pages/home/index';
  const path = `/${route}`;
  const query = Object.entries(current?.options ?? {})
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
  const redirect = encodeURIComponent(query ? `${path}?${query}` : path);

  redirecting = true;
  void Taro.navigateTo({ url: `/pages/login/index?redirect=${redirect}` }).finally(() => {
    redirecting = false;
  });
}

/** 统一请求：需登录接口先确保登录，公开接口允许匿名 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const mode = options.auth ?? 'required';
  if (mode === 'required') {
    if (!hasCurrentConsent()) {
      redirectToLogin();
      throw new NeedLoginError();
    }
    try {
      await ensureLogin();
    } catch (err) {
      if (err instanceof NeedLoginError) redirectToLogin();
      throw err;
    }
  }

  try {
    return await raw<T>(path, options, Boolean(getToken()));
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      clearToken();
      if (mode === 'optional') throw err;
      try {
        await ensureLogin();
      } catch {
        redirectToLogin();
        throw new NeedLoginError();
      }
      return raw<T>(path, options, true);
    }
    if (err instanceof ApiError && err.status === 400 && err.message.includes('协议')) {
      clearConsent();
      clearToken();
      if (mode === 'required') {
        redirectToLogin();
        throw new NeedLoginError();
      }
    }
    throw err;
  }
}

/** 失败提示：登录跳转不弹 toast */
export function showError(err: unknown): void {
  if (err instanceof NeedLoginError) return;
  const message = err instanceof Error ? err.message : '操作失败';
  void Taro.showToast({ title: message, icon: 'none', duration: 2200 });
}
