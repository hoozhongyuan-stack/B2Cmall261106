import { describe, expect, it } from 'vitest';

import {
  MICRO_BANNER_RATIOS,
  MICRO_COMPONENT_LABELS,
  MICRO_COMPONENT_TYPES,
  MICRO_GOODS_LAYOUTS,
  MICRO_GOODS_SOURCES,
  MICRO_INNER_PAGE_PATHS,
  MICRO_INNER_PAGES,
  MICRO_LINK_LABELS,
  MICRO_LINK_TYPES,
  MICRO_PAGE_LIMITS,
  MICRO_VIDEO_RATIOS,
  isMicroPagePathAllowed,
} from '../src/microPage';

describe('微页面共享定义', () => {
  it('组件与链接的标签覆盖全部枚举', () => {
    expect(Object.keys(MICRO_COMPONENT_LABELS)).toHaveLength(MICRO_COMPONENT_TYPES.length);
    expect(Object.keys(MICRO_LINK_LABELS)).toHaveLength(MICRO_LINK_TYPES.length);
    for (const type of MICRO_COMPONENT_TYPES) {
      expect(MICRO_COMPONENT_LABELS[type]).toBeTruthy();
    }
    for (const type of MICRO_LINK_TYPES) {
      expect(MICRO_LINK_LABELS[type]).toBeTruthy();
    }
  });

  it('内置页面路径唯一且以 /pages/ 开头', () => {
    expect(new Set(MICRO_INNER_PAGE_PATHS).size).toBe(MICRO_INNER_PAGE_PATHS.length);
    for (const path of MICRO_INNER_PAGE_PATHS) {
      expect(path.startsWith('/pages/')).toBe(true);
    }
    for (const page of MICRO_INNER_PAGES) {
      expect(page.label).toBeTruthy();
    }
  });

  it('限制常量为合理的正数，导航上下限有序', () => {
    expect(MICRO_PAGE_LIMITS.maxComponents).toBeGreaterThan(0);
    expect(MICRO_PAGE_LIMITS.maxPages).toBeGreaterThan(0);
    expect(MICRO_PAGE_LIMITS.maxTabbarItems).toBeGreaterThanOrEqual(
      MICRO_PAGE_LIMITS.minTabbarItems,
    );
    expect(MICRO_PAGE_LIMITS.maxUploadVideoBytes).toBe(
      MICRO_PAGE_LIMITS.maxVideoBytes,
    );
  });

  it('商品来源、布局与媒体比例枚举非空', () => {
    expect(MICRO_GOODS_SOURCES.length).toBeGreaterThan(0);
    expect(MICRO_GOODS_LAYOUTS.length).toBeGreaterThan(0);
    expect(MICRO_BANNER_RATIOS.length).toBeGreaterThan(0);
    expect(MICRO_VIDEO_RATIOS.length).toBeGreaterThan(0);
  });

  it('内置页面包含积分商城，可被微页面与底部导航选择', () => {
    expect(MICRO_LINK_LABELS.pointsmall).toBe('积分商城');
    expect(MICRO_INNER_PAGE_PATHS).toContain('/pages/points-mall/index');
    expect(isMicroPagePathAllowed('/pages/points-mall/index')).toBe(true);
  });

  it('内置页面包含圈子广场，可被微页面与底部导航选择', () => {
    expect(MICRO_LINK_TYPES).toContain('circle');
    expect(MICRO_LINK_LABELS.circle).toBe('圈子广场');
    expect(MICRO_INNER_PAGE_PATHS).toContain('/pages/circle/index');
    expect(isMicroPagePathAllowed('/pages/circle/index')).toBe(true);
  });

  it('内置页面允许查询参数，但路径必须在白名单内', () => {
    expect(isMicroPagePathAllowed('/pages/orders/index')).toBe(true);
    expect(isMicroPagePathAllowed('/pages/orders/index?status=PAID')).toBe(true);
    expect(isMicroPagePathAllowed('/pages/after-sale/list/index')).toBe(true);
    expect(isMicroPagePathAllowed('/pages/not-exist/index')).toBe(false);
    expect(isMicroPagePathAllowed('')).toBe(false);
  });
});
