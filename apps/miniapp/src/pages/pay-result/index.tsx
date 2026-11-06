import { Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';

import './index.css';

export default function Page() {
  const router = useRouter();
  const orderId = router.params.orderId ?? '';
  const success = (router.params.status ?? 'success') === 'success';

  return (
    <View className="page pay-result">
      <View className={`pay-mark${success ? '' : ' pay-mark--fail'}`}>
        <Text className="pay-mark-icon">{success ? '✓' : '!'}</Text>
      </View>
      <Text className="pay-title">{success ? '支付成功' : '支付结果待确认'}</Text>
      <Text className="muted small pay-hint">
        {success ? '我们会尽快为你打包发货，请留意物流通知' : '如已扣款，请稍后在订单中查看状态'}
      </Text>

      <View className="pay-actions">
        <View
          className="btn btn--primary btn--block"
          onClick={() => {
            if (!orderId) {
              void Taro.redirectTo({ url: '/pages/orders/index' });
              return;
            }
            void Taro.redirectTo({ url: `/pages/order-detail/index?id=${orderId}` });
          }}
        >
          查看订单
        </View>
        <View
          className="btn btn--ghost btn--block pay-home"
          onClick={() => Taro.switchTab({ url: '/pages/home/index' })}
        >
          返回首页
        </View>
      </View>
    </View>
  );
}
