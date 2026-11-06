import Taro from '@tarojs/taro';
import type { ApiEnvelope } from '@shanye/api-types';

const TOKEN_KEY = 'shanye_token';

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

export function getToken(): string {
  return Taro.getStorageSync<string>(TOKEN_KEY) || '';
}

export function setToken(token: string): void {
  Taro.setStorageSync(TOKEN_KEY, token);
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: Method;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
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

let loginTask: Promise<void> | null = null;

/**
 * 静默登录：开发阶段用固定 code 派生稳定 openid，避免每次进页面都变成新用户。
 * 接入真实 jscode2session 后，改为 Taro.login() 取 code 传给后端即可。
 */
export function ensureLogin(): Promise<void> {
  if (getToken()) return Promise.resolve();
  if (loginTask) return loginTask;

  loginTask = raw<{ token: string }>(
    '/auth/wechat-login',
    { method: 'POST', body: { code: 'dev_miniapp_user' } },
    false,
  )
    .then((data) => {
      setToken(data.token);
    })
    .finally(() => {
      loginTask = null;
    });
  return loginTask;
}

/** 统一请求：先确保登录，再解包 { code, message, data } */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  await ensureLogin();
  try {
    return await raw<T>(path, options, true);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      Taro.removeStorageSync(TOKEN_KEY);
      await ensureLogin();
      return raw<T>(path, options, true);
    }
    throw err;
  }
}

/** 失败提示：页面 catch 后调用，避免每处写 showToast */
export function showError(err: unknown): void {
  const message = err instanceof Error ? err.message : '操作失败';
  void Taro.showToast({ title: message, icon: 'none', duration: 2200 });
}
