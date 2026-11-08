import Taro from '@tarojs/taro';

import { api } from '../api/client';

export type SubscribeScene =
  | 'orderPaid'
  | 'orderShipped'
  | 'refundResult'
  | 'pickupReady'
  | 'deliveryAccepted'
  | 'deliveryDone';

interface TemplatesResult {
  templates: Partial<Record<SubscribeScene, string>>;
}

/**
 * 请求一次性订阅授权：模板 ID 由服务端下发，用户拒绝或接口不可用时静默失败，
 * 不阻断支付与售后主流程。
 */
export async function requestSubscriptions(scenes: SubscribeScene[]): Promise<void> {
  if (process.env.TARO_ENV !== 'weapp') return;

  try {
    const { templates } = await api<TemplatesResult>('/subscriptions/templates');
    const tmplIds = [
      ...new Set(
        scenes
          .map((scene) => templates[scene])
          .filter((id): id is string => Boolean(id)),
      ),
    ].slice(0, 3);
    if (!tmplIds.length) return;

    // Taro 4.3 的类型定义把 alipay 的 entityIds 误设为必填，这里按微信小程序参数调用
    await Taro.requestSubscribeMessage({ tmplIds } as never);
  } catch {
    /* 授权失败不阻断业务 */
  }
}
