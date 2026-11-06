import type { ApiEnvelope } from '@shanye/api-types';

const TOKEN_KEY = 'shanye_admin_token';

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
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
}

/** 统一请求：注入 token、解包 { code, message, data }、401 回登录页 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`/api${path}`, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const token = getToken();
  const res = await fetch(url.toString(), {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const payload = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (res.status === 401) {
    clearToken();
    if (!window.location.pathname.startsWith('/login')) window.location.assign('/login');
  }
  if (!res.ok) {
    throw new ApiError(payload?.code ?? 'HTTP_ERROR', payload?.message ?? '请求失败', res.status);
  }
  return (payload?.data ?? (null as T)) as T;
}

/** 金额展示：整数分 → ¥0.00 */
export function money(cents: number | null | undefined): string {
  return `¥${(((cents ?? 0) as number) / 100).toFixed(2)}`;
}

/** 表单输入：元 → 整数分 */
export function toCents(yuan: string | number): number {
  const value = typeof yuan === 'number' ? yuan : Number.parseFloat(yuan || '0');
  return Math.round((Number.isFinite(value) ? value : 0) * 100);
}

/** 整数分 → 元（用于输入框回填，去掉多余小数） */
export function toYuan(cents: number | null | undefined): string {
  const value = ((cents ?? 0) as number) / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function formatDate(value?: string | Date | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
