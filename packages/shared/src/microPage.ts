/**
 * 微页面装修：组件与链接的共享定义。
 * 后台编辑器、服务端校验与小程序渲染共用，避免三处各写一套。
 */

export const MICRO_COMPONENT_TYPES = [
  'notice',
  'search',
  'banner',
  'imageHotspot',
  'goods',
  'divider',
  'video',
  'text',
  'navGrid',
] as const;

export type MicroComponentType = (typeof MICRO_COMPONENT_TYPES)[number];

export const MICRO_COMPONENT_LABELS: Record<MicroComponentType, string> = {
  notice: '公告',
  search: '搜索框',
  banner: '轮播图',
  imageHotspot: '图片热区',
  goods: '商品',
  divider: '辅助线',
  video: '视频',
  text: '文本',
  navGrid: '图文导航',
};

export const MICRO_LINK_TYPES = [
  'none',
  'micro',
  'product',
  'category',
  'search',
  'seckill',
  'coupon',
  'store',
  'cart',
  'orders',
  'mine',
  'points',
  'pointsmall',
  'page',
] as const;

export type MicroLinkType = (typeof MICRO_LINK_TYPES)[number];

export const MICRO_LINK_LABELS: Record<MicroLinkType, string> = {
  none: '不跳转',
  micro: '微页面',
  product: '商品详情',
  category: '分类列表',
  search: '搜索关键词',
  seckill: '秒杀活动',
  coupon: '优惠券',
  store: '门店列表',
  cart: '购物车',
  orders: '我的订单',
  mine: '个人中心',
  points: '积分中心',
  pointsmall: '积分商城',
  page: '内置页面',
};

export interface MicroLink {
  type: MicroLinkType;
  value?: string | null;
}

/** 组件通用样式：像素值，数组顺序为 上 右 下 左 */
export interface MicroComponentStyle {
  margin?: number[];
  padding?: number[];
  bgColor?: string;
  radius?: number;
}

export interface MicroComponent {
  id: string;
  type: MicroComponentType | string;
  visible: boolean;
  style: MicroComponentStyle;
  props: Record<string, unknown>;
}

export interface MicroPageSettings {
  /** 分享标题，为空时用页面标题 */
  shareTitle?: string;
  shareDesc?: string;
  /** 分享图，素材库 key，建议 5:4 */
  shareImageKey?: string;
  /** 页面背景色 */
  bgColor?: string;
  /** 导航栏标题，为空时用页面标题 */
  navTitle?: string;
  /** 导航栏文字颜色：black | white */
  navColor?: 'black' | 'white';
  allowShare?: boolean;
}

export interface MicroPageRelease {
  code: string;
  title: string;
  version: number;
  settings: MicroPageSettings;
  components: MicroComponent[];
  updatedAt: string;
}

export interface ShopTabbarStyle {
  background?: string;
  color?: string;
  selectedColor?: string;
  borderTop?: boolean;
}

export interface ShopTabbarItem {
  key: string;
  text: string;
  iconKey?: string | null;
  activeIconKey?: string | null;
  link: MicroLink;
}

export interface ShopTabbarConfig {
  enabled: boolean;
  style: ShopTabbarStyle;
  items: ShopTabbarItem[];
}

export interface ShopShell {
  tabbar: ShopTabbarConfig;
  /** 首页微页面 code；无可用页面时为空 */
  homeCode: string | null;
  updatedAt: string | null;
}

/** 组件与页面限制：服务端强校验，前端提前提示 */
export const MICRO_PAGE_LIMITS = {
  maxComponents: 50,
  maxPages: 100,
  maxBannerItems: 10,
  maxHotspots: 20,
  maxNavItems: 10,
  maxNoticeLength: 100,
  maxTextLength: 500,
  maxGoods: 50,
  maxTabbarItems: 5,
  minTabbarItems: 2,
  maxVideoBytes: 50 * 1024 * 1024,
  maxUploadVideoBytes: 50 * 1024 * 1024,
} as const;

/** 内置页面白名单：page 类型链接只能指向这里 */
export interface MicroInnerPage {
  label: string;
  path: string;
  /** 需要携带参数时给出提示，如「需 orderId」 */
  hint?: string;
}

export const MICRO_INNER_PAGES: MicroInnerPage[] = [
  { label: '首页', path: '/pages/home/index' },
  { label: '分类页', path: '/pages/category/index' },
  { label: '搜索页', path: '/pages/search/index' },
  { label: '购物车', path: '/pages/cart/index' },
  { label: '我的', path: '/pages/mine/index' },
  { label: '我的订单', path: '/pages/orders/index' },
  { label: '售后列表', path: '/pages/after-sale/list/index' },
  { label: '我的评价', path: '/pages/review/mine/index' },
  { label: '优惠券', path: '/pages/coupon/index' },
  { label: '积分中心', path: '/pages/points/index' },
  { label: '积分商城', path: '/pages/points-mall/index' },
  { label: '会员中心', path: '/pages/member/index' },
  { label: '会员卡', path: '/pages/member-card/index' },
  { label: '收货地址', path: '/pages/address/list/index' },
  { label: '门店列表', path: '/pages/store/list/index' },
  { label: '门店中心', path: '/pages/store-console/index' },
  { label: '商品详情', path: '/pages/product/index', hint: '需 id' },
  { label: '订单详情', path: '/pages/order-detail/index', hint: '需 id' },
  { label: '售后详情', path: '/pages/after-sale/detail/index', hint: '需 id' },
  { label: '物流详情', path: '/pages/shipment/index', hint: '需 id' },
  { label: '支付结果', path: '/pages/pay-result/index', hint: '需 orderNo' },
  { label: '结算页', path: '/pages/checkout/index' },
];

export const MICRO_INNER_PAGE_PATHS = MICRO_INNER_PAGES.map((item) => item.path);

/** page 链接允许附加查询串，路径部分必须在白名单内 */
export function isMicroPagePathAllowed(value: string): boolean {
  const path = (value ?? '').split('?')[0];
  return MICRO_INNER_PAGE_PATHS.includes(path);
}

/** 商品组件数据来源 */
export const MICRO_GOODS_SOURCES = ['manual', 'category', 'seckill', 'picks'] as const;
export type MicroGoodsSource = (typeof MICRO_GOODS_SOURCES)[number];

export const MICRO_GOODS_LAYOUTS = ['grid-2', 'grid-3', 'list', 'scroll-x'] as const;
export type MicroGoodsLayout = (typeof MICRO_GOODS_LAYOUTS)[number];

export const MICRO_BANNER_RATIOS = ['16:9', '4:3', '3:2', '2:1'] as const;
export const MICRO_VIDEO_RATIOS = ['16:9', '4:3', '1:1'] as const;
