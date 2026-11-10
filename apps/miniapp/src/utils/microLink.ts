import Taro from '@tarojs/taro';

import type { MicroLink } from '@shanye/shared/src/microPage';
import { api } from '../api/client';

/** 微页面统一链接跳转：同一微页面不重复打开 */
export async function openMicroLink(link: MicroLink | null | undefined): Promise<void> {
  if (!link || link.type === 'none') return;
  const value = (link.value ?? '').trim();

  switch (link.type) {
    case 'micro': {
      if (!value) return;
      const pages = Taro.getCurrentPages();
      const current = pages[pages.length - 1] as unknown as {
        route?: string;
        options?: Record<string, string>;
      };
      if (current?.route?.replace(/^\//, '') === 'pages/micro/index' && current.options?.code === value) return;
      void Taro.navigateTo({ url: `/pages/micro/index?code=${encodeURIComponent(value)}` });
      return;
    }
    case 'product':
      if (!value) return;
      void Taro.navigateTo({ url: `/pages/product/index?id=${encodeURIComponent(value)}` });
      return;
    case 'category':
      void Taro.navigateTo({
        url: value
          ? `/pages/category/index?categoryId=${encodeURIComponent(value)}`
          : '/pages/category/index',
      });
      return;
    case 'search':
      void Taro.navigateTo({
        url: value ? `/pages/search/index?keyword=${encodeURIComponent(value)}` : '/pages/search/index',
      });
      return;
    case 'seckill': {
      const items = await api<{ promotionId: string; productId: string }[]>('/promotions/seckill', {
        auth: 'optional',
      }).catch(() => []);
      const hit = value ? items.find((item) => item.promotionId === value) : items[0];
      if (hit) {
        void Taro.navigateTo({ url: `/pages/product/index?id=${encodeURIComponent(hit.productId)}` });
      } else {
        void Taro.showToast({ title: '活动已结束', icon: 'none' });
      }
      return;
    }
    case 'coupon':
      void Taro.navigateTo({ url: '/pages/coupon/index' });
      return;
    case 'store':
      void Taro.navigateTo({ url: '/pages/store/list/index' });
      return;
    case 'cart':
      void Taro.navigateTo({ url: '/pages/cart/index' });
      return;
    case 'orders':
      void Taro.navigateTo({ url: '/pages/orders/index' });
      return;
    case 'mine':
      void Taro.navigateTo({ url: '/pages/mine/index' });
      return;
    case 'points':
      void Taro.navigateTo({ url: '/pages/points/index' });
      return;
    case 'page':
      if (!value || !value.startsWith('/pages/')) return;
      void Taro.navigateTo({ url: value });
      return;
    default:
      return;
  }
}
