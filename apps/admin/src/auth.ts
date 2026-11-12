import type { PermissionKey } from '@shanye/shared/src/permissions';

import { api, clearToken, getToken, setToken } from './api/client';

export interface AdminRoleSummary {
  id: string;
  name: string;
}

export interface AdminSession {
  id: string;
  name: string;
  isSuper: boolean;
  role: AdminRoleSummary | null;
  permissions: string[];
}

const USER_KEY = 'shanye_admin_user';

export function getSession(): AdminSession | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Partial<AdminSession>;
    // 旧版本会话没有权限字段，且旧 token 不含角色信息，直接清理并重新登录
    if (!Array.isArray(session.permissions)) {
      clearToken();
      localStorage.removeItem(USER_KEY);
      return null;
    }
    return session as AdminSession;
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

export function updateSessionUser(user: AdminSession): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function logout(): void {
  clearToken();
  localStorage.removeItem(USER_KEY);
  // 兼容部署在子路径（如 /admin/）的情况
  window.location.assign(`${import.meta.env.BASE_URL}login`);
}

/** 权限判断：后端为准，前端只用于菜单、路由与按钮显隐 */
export function can(permission: PermissionKey | string): boolean {
  const session = getSession();
  if (!session) return false;
  // 兼容旧版本地会话（没有 permissions 字段），刷新后由 /admin/auth/me 补齐
  return session.isSuper || (session.permissions ?? []).includes(permission);
}

export function isSuperAdmin(): boolean {
  return Boolean(getSession()?.isSuper);
}

export function hasAnyPermission(...permissions: string[]): boolean {
  return permissions.some((permission) => can(permission));
}

/** 刷新页面时同步最新角色与权限（角色调整后无需重新登录） */
export async function refreshSession(): Promise<void> {
  if (!getToken()) return;
  try {
    const user = await api<AdminSession>('/admin/auth/me');
    updateSessionUser(user);
  } catch {
    // 登录态失效由接口层统一处理；这里不打断页面
  }
}
