import { BadRequestException } from '@nestjs/common';
import { tokens } from '@shanye/tokens';
import { randomBytes } from 'node:crypto';

import {
  MICRO_BANNER_RATIOS,
  MICRO_COMPONENT_LABELS,
  MICRO_COMPONENT_TYPES,
  MICRO_GOODS_LAYOUTS,
  MICRO_GOODS_SOURCES,
  MICRO_LINK_LABELS,
  MICRO_LINK_TYPES,
  MICRO_PAGE_LIMITS,
  MICRO_VIDEO_RATIOS,
  isMicroPagePathAllowed,
  type MicroComponent,
  type MicroComponentStyle,
  type MicroComponentType,
  type MicroLink,
  type MicroPageSettings,
} from '@shanye/shared';

import { PrismaService } from '../../prisma/prisma.module';
import { AssetService } from '../assets/asset.service';

export interface ValidateContext {
  prisma: PrismaService;
  assets: AssetService;
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function fail(label: string, message: string): never {
  throw new BadRequestException(`${label}：${message}`);
}

function newComponentId(): string {
  return `cmp_${randomBytes(6).toString('hex')}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(
  value: unknown,
  max: number,
  label: string,
  options: { required?: boolean } = {},
): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (options.required && !text) fail(label, '不能为空');
  if (text.length > max) fail(label, `不能超过 ${max} 个字符`);
  return text;
}

function numberOf(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  label: string,
): number {
  if (value === undefined || value === null || value === '') return fallback;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) fail(label, '必须是数字');
  if (num < min || num > max) fail(label, `必须在 ${min}~${max} 之间`);
  return Math.round(num * 100) / 100;
}

function intOf(value: unknown, min: number, max: number, fallback: number, label: string): number {
  return Math.round(numberOf(value, min, max, fallback, label));
}

function boolOf(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function colorOf(value: unknown, fallback = '', label = '颜色'): string {
  const color = typeof value === 'string' ? value.trim() : '';
  if (!color) return fallback;
  if (!HEX.test(color)) fail(label, '仅支持 #RGB / #RRGGBB');
  return color;
}

function enumOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
  label: string,
): T[number] {
  if (typeof value !== 'string' || !value) return fallback;
  if (!(allowed as readonly string[]).includes(value)) fail(label, '不支持的取值');
  return value as T[number];
}

function spacingOf(value: unknown, label: string): number[] {
  if (value === undefined || value === null) return [0, 0, 0, 0];
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 1) list.push(list[0], list[0], list[0]);
  if (list.length === 2) list.push(list[0], list[1]);
  if (list.length !== 4) fail(label, '需要 1 / 2 / 4 个数值');
  return list.map((item, index) => intOf(item, 0, 80, 0, `${label}第 ${index + 1} 项`));
}

function styleOf(value: unknown, label: string): MicroComponentStyle {
  const style = asRecord(value) ?? {};
  return {
    margin: spacingOf(style.margin, `${label}外边距`),
    padding: spacingOf(style.padding, `${label}内边距`),
    bgColor: colorOf(style.bgColor, '', `${label}背景色`),
    radius: intOf(style.radius, 0, 32, 0, `${label}圆角`),
  };
}

async function validateLink(
  value: unknown,
  ctx: ValidateContext,
  label: string,
  strict = true,
): Promise<MicroLink> {
  if (value === undefined || value === null) return { type: 'none', value: null };
  const input = asRecord(value);
  if (!input) fail(label, '链接格式不正确');

  const type = String(input.type ?? 'none') as MicroLink['type'];
  if (!(MICRO_LINK_TYPES as readonly string[]).includes(type)) fail(label, '不支持的跳转类型');
  if (type === 'none') return { type: 'none', value: null };

  // 固定去向不需要选择目标（购物车 / 订单 / 我的 / 积分）
  if (type === 'cart' || type === 'orders' || type === 'mine' || type === 'points') {
    return { type, value: null };
  }

  // 搜索 / 优惠券 / 门店允许不指定具体目标，直接进入对应列表页
  const target = textOf(input.value, 300, label);
  if (!target) {
    if (type === 'search' || type === 'coupon' || type === 'store') {
      return { type, value: null };
    }
    if (!strict) return { type, value: null };
    fail(label, '不能为空');
  }
  const linkLabel = MICRO_LINK_LABELS[type] ?? '跳转目标';

  if (type === 'micro') {
    const page = await ctx.prisma.microPage.findFirst({
      where: { code: target, deletedAt: null },
      select: { id: true },
    });
    if (!page) fail(label, '目标微页面不存在');
  } else if (type === 'product') {
    const product = await ctx.prisma.product.findUnique({
      where: { id: target },
      select: { id: true, status: true },
    });
    if (!product || product.status !== 'ON_SALE') fail(label, '目标商品不存在或已下架');
  } else if (type === 'category') {
    const category = await ctx.prisma.category.findUnique({
      where: { id: target },
      select: { id: true },
    });
    if (!category) fail(label, '目标分类不存在');
  } else if (type === 'search') {
    if (target.length > 50) fail(label, '搜索关键词过长');
  } else if (type === 'seckill') {
    const promotion = await ctx.prisma.promotion.findUnique({
      where: { id: target },
      select: { id: true, type: true },
    });
    if (!promotion || promotion.type !== 'SECKILL') fail(label, '目标秒杀活动不存在');
  } else if (type === 'coupon') {
    const coupon = await ctx.prisma.coupon.findUnique({ where: { id: target }, select: { id: true } });
    if (!coupon) fail(label, '目标优惠券不存在');
  } else if (type === 'store') {
    const store = await ctx.prisma.store.findUnique({ where: { id: target }, select: { id: true } });
    if (!store) fail(label, '目标门店不存在');
  } else if (type === 'page') {
    if (!target.startsWith('/pages/') || !isMicroPagePathAllowed(target)) {
      fail(label, `${linkLabel}只能选择内置页面`);
    }
    if (/[#\s]/.test(target)) fail(label, '页面参数不能包含空格或 #');
    if (target.length > 200) fail(label, '页面路径过长');
  }

  return { type, value: target };
}

async function assertImage(
  value: unknown,
  ctx: ValidateContext,
  label: string,
  required = false,
): Promise<string> {
  const key = textOf(value, 300, label, { required });
  if (!key) return '';
  await ctx.assets.assertReference(key);
  return key;
}

async function assertVideo(
  value: unknown,
  ctx: ValidateContext,
  label: string,
  strict = true,
): Promise<string> {
  const key = textOf(value, 300, label, { required: strict });
  if (!key) return '';
  await ctx.assets.assertVideoReference(key);
  return key;
}

/* ---------------- 各组件属性校验 ---------------- */

async function noticeProps(
  input: Record<string, unknown>,
  ctx: ValidateContext,
  label: string,
  strict: boolean,
): Promise<Record<string, unknown>> {
  return {
    text: textOf(input.text, MICRO_PAGE_LIMITS.maxNoticeLength, `${label}文案`, { required: strict }),
    tag: textOf(input.tag, 10, `${label}标签`),
    scroll: boolOf(input.scroll, true),
    speed: intOf(input.speed, 30, 200, 80, `${label}滚动速度`),
    textColor: colorOf(input.textColor, '', `${label}文字色`),
    bgColor: colorOf(input.bgColor, '', `${label}背景色`),
    link: await validateLink(input.link, ctx, `${label}链接`, strict),
  };
}

async function searchProps(
  input: Record<string, unknown>,
  ctx: ValidateContext,
  label: string,
  strict: boolean,
): Promise<Record<string, unknown>> {
  const rawHotwords = Array.isArray(input.hotwords) ? input.hotwords : [];
  const hotwords = rawHotwords
    .map((item) => textOf(item, 20, `${label}热词`))
    .filter(Boolean)
    .slice(0, 6);
  return {
    placeholder: textOf(input.placeholder, 20, `${label}占位文案`) || '搜索山野好物',
    shape: enumOf(input.shape, ['capsule', 'rounded', 'square'] as const, 'capsule', `${label}形状`),
    bgColor: colorOf(input.bgColor, '', `${label}背景色`),
    textColor: colorOf(input.textColor, '', `${label}文字色`),
    showHotwords: boolOf(input.showHotwords, false),
    hotwords,
    link: await validateLink(input.link, ctx, `${label}链接`, strict),
  };
}

async function bannerProps(
  input: Record<string, unknown>,
  ctx: ValidateContext,
  label: string,
  strict: boolean,
): Promise<Record<string, unknown>> {
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (!rawItems.length && strict) fail(label, '至少添加 1 张图片');
  if (rawItems.length > MICRO_PAGE_LIMITS.maxBannerItems) {
    fail(label, `最多 ${MICRO_PAGE_LIMITS.maxBannerItems} 张图片`);
  }
  const items = [];
  for (const [index, raw] of rawItems.entries()) {
    const item = asRecord(raw);
    if (!item) fail(label, `第 ${index + 1} 张图片格式不正确`);
    items.push({
      imageKey: await assertImage(item.imageKey, ctx, `${label}第 ${index + 1} 张图片`, strict),
      title: textOf(item.title, 40, `${label}第 ${index + 1} 张标题`),
      link: await validateLink(item.link, ctx, `${label}第 ${index + 1} 张链接`, strict),
    });
  }
  return {
    items,
    ratio: enumOf(input.ratio, MICRO_BANNER_RATIOS, '2:1', `${label}高度比`),
    autoplay: boolOf(input.autoplay, true),
    interval: intOf(input.interval, 2, 10, 4, `${label}间隔`),
    indicator: enumOf(input.indicator, ['dots', 'none'] as const, 'dots', `${label}指示器`),
  };
}

async function imageHotspotProps(
  input: Record<string, unknown>,
  ctx: ValidateContext,
  label: string,
  strict: boolean,
): Promise<Record<string, unknown>> {
  const imageKey = await assertImage(input.imageKey, ctx, `${label}主图`, strict);
  const rawSpots = Array.isArray(input.hotspots) ? input.hotspots : [];
  if (rawSpots.length > MICRO_PAGE_LIMITS.maxHotspots) {
    fail(label, `最多 ${MICRO_PAGE_LIMITS.maxHotspots} 个热区`);
  }
  const hotspots = [];
  for (const [index, raw] of rawSpots.entries()) {
    const spot = asRecord(raw);
    if (!spot) fail(label, `第 ${index + 1} 个热区格式不正确`);
    const width = numberOf(spot.w, 1, 100, 0, `${label}第 ${index + 1} 个热区宽度`);
    const height = numberOf(spot.h, 1, 100, 0, `${label}第 ${index + 1} 个热区高度`);
    const x = numberOf(spot.x, 0, 100, 0, `${label}第 ${index + 1} 个热区 X`);
    const y = numberOf(spot.y, 0, 100, 0, `${label}第 ${index + 1} 个热区 Y`);
    if (x + width > 100 || y + height > 100) fail(label, `第 ${index + 1} 个热区超出图片范围`);
    hotspots.push({
      x,
      y,
      w: width,
      h: height,
      link: await validateLink(spot.link, ctx, `${label}第 ${index + 1} 个热区链接`, strict),
    });
  }
  return {
    imageKey,
    alt: textOf(input.alt, 40, `${label}替代文案`),
    hotspots,
  };
}

async function goodsProps(
  input: Record<string, unknown>,
  ctx: ValidateContext,
  label: string,
  strict: boolean,
): Promise<Record<string, unknown>> {
  const source = enumOf(input.source, MICRO_GOODS_SOURCES, 'picks', `${label}数据来源`);
  let productIds: string[] = [];
  let categoryId = '';
  let promotionId = '';

  if (source === 'manual') {
    const rawIds = Array.isArray(input.productIds) ? input.productIds : [];
    productIds = [...new Set(rawIds.map((item) => textOf(item, 40, `${label}商品`)).filter(Boolean))];
    if (!productIds.length && strict) fail(label, '请至少选择 1 个商品');
    if (productIds.length > MICRO_PAGE_LIMITS.maxGoods) {
      fail(label, `最多选择 ${MICRO_PAGE_LIMITS.maxGoods} 个商品`);
    }
    if (productIds.length) {
      const count = await ctx.prisma.product.count({
        where: { id: { in: productIds }, status: 'ON_SALE' },
      });
      if (count !== productIds.length) fail(label, '包含不存在或已下架的商品，请重新选择');
    }
  } else if (source === 'category') {
    categoryId = textOf(input.categoryId, 40, `${label}分类`, { required: strict });
    const category = await ctx.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) fail(label, '所选分类不存在');
  } else if (source === 'seckill') {
    const raw = textOf(input.promotionId, 40, `${label}秒杀活动`);
    if (raw) {
      const promotion = await ctx.prisma.promotion.findUnique({
        where: { id: raw },
        select: { id: true, type: true },
      });
      if (!promotion || promotion.type !== 'SECKILL') fail(label, '所选秒杀活动不存在');
      promotionId = raw;
    }
  }

  const show = asRecord(input.show) ?? {};
  return {
    source,
    productIds,
    categoryId,
    promotionId,
    limit: intOf(input.limit, 1, MICRO_PAGE_LIMITS.maxGoods, 6, `${label}数量`),
    layout: enumOf(input.layout, MICRO_GOODS_LAYOUTS, 'grid-2', `${label}列表样式`),
    show: {
      price: boolOf(show.price, true),
      originPrice: boolOf(show.originPrice, true),
      sales: boolOf(show.sales, false),
      tag: boolOf(show.tag, false),
    },
    buyButton: boolOf(input.buyButton, false),
    cardBg: colorOf(input.cardBg, '', `${label}卡片背景`),
  };
}

function dividerProps(input: Record<string, unknown>, label: string): Record<string, unknown> {
  return {
    style: enumOf(input.style, ['solid', 'dashed', 'dotted'] as const, 'solid', `${label}线型`),
    color: colorOf(input.color, tokens.color.line2, `${label}颜色`),
    thickness: intOf(input.thickness, 1, 8, 1, `${label}粗细`),
    spacing: intOf(input.spacing, 0, 40, 12, `${label}间距`),
  };
}

async function videoProps(
  input: Record<string, unknown>,
  ctx: ValidateContext,
  label: string,
  strict: boolean,
): Promise<Record<string, unknown>> {
  return {
    videoKey: await assertVideo(input.videoKey, ctx, `${label}视频`, strict),
    coverKey: await assertImage(input.coverKey, ctx, `${label}封面`, strict),
    ratio: enumOf(input.ratio, MICRO_VIDEO_RATIOS, '16:9', `${label}宽高比`),
    autoplay: boolOf(input.autoplay, false),
    loop: boolOf(input.loop, false),
    muted: boolOf(input.muted, true),
  };
}

async function textProps(
  input: Record<string, unknown>,
  ctx: ValidateContext,
  label: string,
  strict: boolean,
): Promise<Record<string, unknown>> {
  return {
    content: textOf(input.content, MICRO_PAGE_LIMITS.maxTextLength, `${label}文案`, {
      required: true,
    }),
    fontSize: intOf(input.fontSize, 12, 32, 14, `${label}字号`),
    color: colorOf(input.color, tokens.color.ink, `${label}颜色`),
    weight: enumOf(input.weight, ['normal', 'bold'] as const, 'normal', `${label}字重`),
    align: enumOf(input.align, ['left', 'center', 'right'] as const, 'left', `${label}对齐`),
    lineHeight: numberOf(input.lineHeight, 1, 2.5, 1.5, `${label}行高`),
    maxLines: intOf(input.maxLines, 0, 10, 0, `${label}最大行数`),
    link: await validateLink(input.link, ctx, `${label}链接`, strict),
  };
}

async function navGridProps(
  input: Record<string, unknown>,
  ctx: ValidateContext,
  label: string,
  strict: boolean,
): Promise<Record<string, unknown>> {
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (!rawItems.length && strict) fail(label, '至少添加 1 个入口');
  if (rawItems.length > MICRO_PAGE_LIMITS.maxNavItems) {
    fail(label, `最多 ${MICRO_PAGE_LIMITS.maxNavItems} 个入口`);
  }
  const items = [];
  for (const [index, raw] of rawItems.entries()) {
    const item = asRecord(raw);
    if (!item) fail(label, `第 ${index + 1} 个入口格式不正确`);
    items.push({
      name: textOf(item.name, 6, `${label}第 ${index + 1} 个入口名称`, { required: strict }),
      iconKey: await assertImage(item.iconKey, ctx, `${label}第 ${index + 1} 个入口图标`),
      link: await validateLink(item.link, ctx, `${label}第 ${index + 1} 个入口链接`, strict),
    });
  }
  return {
    columns: intOf(input.columns, 4, 5, 4, `${label}每行数量`),
    iconShape: enumOf(input.iconShape, ['circle', 'square'] as const, 'circle', `${label}图标形状`),
    textColor: colorOf(input.textColor, '', `${label}文字颜色`),
    fontSize: intOf(input.fontSize, 10, 16, 12, `${label}字号`),
    items,
  };
}

/**
 * 组件文档校验与归一化：未知类型、缺少必填、图片/视频不存在、链接失效都会 400。
 * 返回值可直接写入数据库，避免把前端多余字段带进 JSON。
 */
export async function validateComponents(
  input: unknown,
  ctx: ValidateContext,
  strict = true,
): Promise<MicroComponent[]> {
  if (!Array.isArray(input)) throw new BadRequestException('组件数据格式不正确');
  if (input.length > MICRO_PAGE_LIMITS.maxComponents) {
    throw new BadRequestException(`单个页面最多 ${MICRO_PAGE_LIMITS.maxComponents} 个组件`);
  }

  const ids = new Set<string>();
  const result: MicroComponent[] = [];

  for (const [index, raw] of input.entries()) {
    const item = asRecord(raw);
    if (!item) throw new BadRequestException(`第 ${index + 1} 个组件格式不正确`);

    const type = String(item.type ?? '');
    if (!(MICRO_COMPONENT_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException(`第 ${index + 1} 个组件类型不支持`);
    }
    const componentType = type as MicroComponentType;
    const label = `第 ${index + 1} 个组件（${MICRO_COMPONENT_LABELS[componentType]}）`;

    let id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id || ids.has(id)) id = newComponentId();
    ids.add(id);

    const props = asRecord(item.props) ?? {};
    let normalized: Record<string, unknown>;
    switch (componentType) {
      case 'notice':
        normalized = await noticeProps(props, ctx, label, strict);
        break;
      case 'search':
        normalized = await searchProps(props, ctx, label, strict);
        break;
      case 'banner':
        normalized = await bannerProps(props, ctx, label, strict);
        break;
      case 'imageHotspot':
        normalized = await imageHotspotProps(props, ctx, label, strict);
        break;
      case 'goods':
        normalized = await goodsProps(props, ctx, label, strict);
        break;
      case 'divider':
        normalized = dividerProps(props, label);
        break;
      case 'video':
        normalized = await videoProps(props, ctx, label, strict);
        break;
      case 'text':
        normalized = await textProps(props, ctx, label, strict);
        break;
      case 'navGrid':
        normalized = await navGridProps(props, ctx, label, strict);
        break;
      default:
        throw new BadRequestException(`${label}类型不支持`);
    }

    result.push({
      id,
      type: componentType,
      visible: boolOf(item.visible, true),
      style: styleOf(item.style, label),
      props: normalized,
    });
  }

  return result;
}

/** 页面设置校验：分享图必须来自素材库 */
export async function validateSettings(
  input: unknown,
  ctx: ValidateContext,
): Promise<MicroPageSettings> {
  const settings = asRecord(input) ?? {};
  return {
    shareTitle: textOf(settings.shareTitle, 40, '分享标题'),
    shareDesc: textOf(settings.shareDesc, 80, '分享描述'),
    shareImageKey: await assertImage(settings.shareImageKey, ctx, '分享图'),
    bgColor: colorOf(settings.bgColor, '', '页面背景色'),
    navTitle: textOf(settings.navTitle, 20, '导航栏标题'),
    navColor: enumOf(settings.navColor, ['black', 'white'] as const, 'black', '导航栏文字颜色'),
    allowShare: boolOf(settings.allowShare, true),
  };
}

export { validateLink };
