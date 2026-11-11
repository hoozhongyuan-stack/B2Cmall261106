/** 弹窗广告共享限制与规则 */

export const POPUP_AD_LIMITS = {
  /** 单次最多下发 / 启用条数 */
  maxActive: 10,
  maxAds: 50,
  /** 图片统一 3:4 */
  imageRatio: '3:4',
  maxImageBytes: 5 * 1024 * 1024,
} as const;

/** 本地已看记录：{ date: 'YYYY-MM-DD', adIds: string[] } */
export interface PopupAdSeen {
  date: string;
  adIds: string[];
}

export const POPUP_AD_SEEN_KEY = 'shanye_popup_seen';
