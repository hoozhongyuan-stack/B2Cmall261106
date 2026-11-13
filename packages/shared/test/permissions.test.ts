import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSIONS,
  PERMISSION_DEPENDENCIES,
  PERMISSION_GROUPS,
  isPermissionKey,
  permissionName,
} from '../src/permissions';

describe('权限目录', () => {
  it('分组与权限 key 唯一且格式统一', () => {
    expect(PERMISSION_GROUPS.length).toBe(10);
    const keys = ALL_PERMISSIONS;
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z]+\.[a-z]+$/);
    for (const group of PERMISSION_GROUPS) {
      expect(group.items.length).toBeGreaterThan(0);
      for (const item of group.items) expect(item.name.length).toBeGreaterThan(0);
    }
  });

  it('isPermissionKey 只接受目录内的 key', () => {
    for (const key of ALL_PERMISSIONS) expect(isPermissionKey(key)).toBe(true);
    expect(isPermissionKey('order.unknown')).toBe(false);
    expect(isPermissionKey('')).toBe(false);
  });

  it('permissionName 返回中文名称，未知 key 原样返回', () => {
    expect(permissionName('order.ship')).toBe('发货 / 批量发货');
    expect(permissionName('unknown.key')).toBe('unknown.key');
  });

  it('写权限依赖的查看权限都在目录内', () => {
    for (const [key, dependencies] of Object.entries(PERMISSION_DEPENDENCIES)) {
      expect(isPermissionKey(key)).toBe(true);
      expect(dependencies?.length).toBeGreaterThan(0);
      for (const dependency of dependencies ?? []) {
        expect(isPermissionKey(dependency)).toBe(true);
      }
    }
  });
});
