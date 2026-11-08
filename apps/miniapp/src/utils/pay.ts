import Taro from '@tarojs/taro';
import { ORDER_STATUS, type OrderStatus } from '@shanye/shared/src/orderState';

import { api } from '../api/client';
import { requestSubscriptions } from './subscribe';

interface PayParams {
  provider: 'mock' | 'wechat';
  outTradeNo: string;
  payParams?: {
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: 'RSA';
    paySign: string;
  };
}

export type PayOutcome = 'paid' | 'pending';

/** 微信支付调起后回调可能晚于前端返回，最多轮询 5 次确认订单状态 */
const POLL_TIMES = 5;
const POLL_INTERVAL_MS = 800;

/**
 * 统一下单 + 调起支付。
 * mock 渠道直接确认支付；wechat 渠道调起微信收银台，H5 预览不支持。
 */
export async function payOrder(orderId: string): Promise<PayOutcome> {
  const pay = await api<PayParams>(`/orders/${orderId}/pay`, { method: 'POST' });

  if (pay.provider === 'mock') {
    await api('/payments/mock/confirm', {
      method: 'POST',
      body: { outTradeNo: pay.outTradeNo },
    });
    return 'paid';
  }

  if (process.env.TARO_ENV !== 'weapp') {
    throw new Error('请在微信小程序内完成支付');
  }
  if (!pay.payParams) throw new Error('支付参数缺失，请重试');

  // 支付与发货通知在点击手势内提前授权，用户拒绝不影响支付
  await requestSubscriptions(['orderPaid', 'orderShipped']);

  try {
    await Taro.requestPayment({
      timeStamp: pay.payParams.timeStamp,
      nonceStr: pay.payParams.nonceStr,
      package: pay.payParams.package,
      signType: 'RSA' as never,
      paySign: pay.payParams.paySign,
    });
  } catch (err) {
    const errMsg =
      err && typeof err === 'object' && 'errMsg' in err
        ? String((err as { errMsg?: string }).errMsg ?? '')
        : '';
    if (errMsg.toLowerCase().includes('cancel')) throw new Error('已取消支付');
    throw err instanceof Error ? err : new Error('支付失败，请重试');
  }

  for (let i = 0; i < POLL_TIMES; i += 1) {
    const order = await api<{ status: OrderStatus }>(`/orders/${orderId}`);
    if (order.status === ORDER_STATUS.PAID) return 'paid';
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return 'pending';
}
