import Taro from '@tarojs/taro';

import type { ShopShell } from '@shanye/shared/src/microPage';
import { api } from '../api/client';

const SHELL_KEY = 'shanye_shell';
const SHELL_TTL = 5 * 60 * 1000;

interface CachedShell {
  shell: ShopShell;
  savedAt: number;
}

/** 兜底配置：接口不可用时仍能展示底部导航 */
export const DEFAULT_SHELL: ShopShell = {
  tabbar: {
    enabled: true,
    style: {},
    items: [
      { key: 'home', text: '首页', iconKey: null, activeIconKey: null, link: { type: 'page', value: '/pages/home/index' } },
      { key: 'category', text: '分类', iconKey: null, activeIconKey: null, link: { type: 'page', value: '/pages/category/index' } },
      { key: 'cart', text: '购物车', iconKey: null, activeIconKey: null, link: { type: 'page', value: '/pages/cart/index' } },
      { key: 'mine', text: '我的', iconKey: null, activeIconKey: null, link: { type: 'page', value: '/pages/mine/index' } },
    ],
  },
  homeCode: null,
  updatedAt: null,
};

function readCache(): CachedShell | null {
  const cached = Taro.getStorageSync<CachedShell | ''>(SHELL_KEY);
  if (!cached || typeof cached !== 'object' || !cached.shell) return null;
  return cached;
}

export function cachedShell(): ShopShell {
  return readCache()?.shell ?? DEFAULT_SHELL;
}

/** 读取启动配置：5 分钟内复用缓存，过期后静默刷新 */
export async function loadShell(force = false): Promise<ShopShell> {
  const cached = readCache();
  if (!force && cached && Date.now() - cached.savedAt < SHELL_TTL) {
    return cached.shell;
  }
  try {
    const shell = await api<ShopShell>('/shop/shell', { auth: 'optional' });
    Taro.setStorageSync(SHELL_KEY, { shell, savedAt: Date.now() });
    return shell;
  } catch {
    return cached?.shell ?? DEFAULT_SHELL;
  }
}
