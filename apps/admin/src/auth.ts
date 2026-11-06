import { clearToken, getToken, setToken } from './api/client';

export type AdminRole = 'SUPER' | 'OPS' | 'CS' | 'WMS';

export interface AdminSession {
  id: string;
  name: string;
  role: AdminRole;
}

const USER_KEY = 'shanye_admin_user';

export function getSession(): AdminSession | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AdminSession;
  } catch {
    return null;
  }
}

export function isLoggedIn(): boolean {
  return Boolean(getToken() && getSession());
}

export function saveSession(token: string, user: AdminSession): void {
  setToken(token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function logout(): void {
  clearToken();
  localStorage.removeItem(USER_KEY);
  // 兼容部署在子路径（如 /admin/）的情况
  window.location.assign(`${import.meta.env.BASE_URL}login`);
}

/** 角色权限：与后端 @Roles 保持一致，前端仅做菜单与按钮显隐 */
export function hasRole(...roles: AdminRole[]): boolean {
  const session = getSession();
  return Boolean(session && roles.includes(session.role));
}

export const ROLE_LABEL: Record<AdminRole, string> = {
  SUPER: '超级管理员',
  OPS: '商品运营',
  CS: '客服',
  WMS: '仓储',
};
