import { Input, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';

import { api, showError } from '../../api/client';
import { money } from '../../utils/format';
import { scanQrFromImage } from '../../utils/scan';

import './verify.css';

interface PickupResult {
  alreadyVerified: boolean;
  order: {
    orderNo: string;
    status: string;
    pickupCode: string | null;
    payableCents: number;
    store: { name: string; address: string; phone: string | null } | null;
    items: { title: string; specText: string; quantity: number }[];
  };
}

export default function Page() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PickupResult | null>(null);
  const [inputFocus, setInputFocus] = useState(false);
  const isH5 = process.env.TARO_ENV === 'h5';

  useEffect(() => {
    if (router.params.focus === '1') {
      void scan();
    }
  }, []);

  useDidShow(() => {
    /* 返回本页时保留上一次核销结果，便于店员核对 */
  });

  async function scan() {
    if (isH5) {
      try {
        const text = await scanQrFromImage();
        if (!text) {
          setInputFocus(true);
          await Taro.showToast({ title: '未识别到二维码，请重试或手动输入', icon: 'none' });
          return;
        }
        const digits = text.replace(/\D/g, '').slice(-8);
        if (!digits) {
          setInputFocus(true);
          await Taro.showToast({ title: '未识别到核销码', icon: 'none' });
          return;
        }
        setCode(digits);
        await submit(digits);
      } catch (err) {
        const message = (err as { errMsg?: string })?.errMsg ?? '';
        if (message.includes('cancel')) return;
        setInputFocus(true);
        await Taro.showToast({ title: '无法读取二维码，请手动输入', icon: 'none' });
      }
      return;
    }
    try {
      const scanResult = await Taro.scanCode({ scanType: ['barCode', 'qrCode'] });
      const digits = scanResult.result.replace(/\D/g, '').slice(-8);
      if (!digits) {
        await Taro.showToast({ title: '未识别到核销码', icon: 'none' });
        return;
      }
      setCode(digits);
      await submit(digits);
    } catch (err) {
      const message = (err as { errMsg?: string })?.errMsg ?? '';
      if (message.includes('cancel')) return;
      if (message.includes('auth') || message.includes('permission')) {
        await Taro.showModal({
          title: '需要相机权限',
          content: '请在设置中允许使用摄像头后重试，或手动输入 8 位核销码。',
          showCancel: false,
        });
        return;
      }
      await Taro.showToast({ title: '扫码失败，请重试或手动输入', icon: 'none' });
    }
  }

  async function submit(value?: string) {
    const target = (value ?? code).trim();
    if (!/^\d{8}$/.test(target)) {
      await Taro.showToast({ title: '请输入 8 位核销码', icon: 'none' });
      return;
    }
    setBusy(true);
    try {
      const data = await api<PickupResult>('/store-console/pickups/verify', {
        method: 'POST',
        body: { code: target },
      });
      setResult(data);
      void Taro.vibrateShort({ type: 'light' }).catch(() => undefined);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    setCode('');
  }

  if (result) {
    const order = result.order;
    return (
      <View className="page">
        <View className={`verify-result${result.alreadyVerified ? ' is-dup' : ''}`}>
          <Text className="verify-result-title">
            {result.alreadyVerified ? '该订单已核销' : '核销成功'}
          </Text>
          <Text className="verify-order-no">{order.orderNo}</Text>
          <Text className="verify-amount">{money(order.payableCents)}</Text>
        </View>

        <View className="card">
          <Text className="small">商品</Text>
          {order.items.map((item, index) => (
            <View className="verify-item" key={`${item.title}-${index}`}>
              <Text className="small grow">{item.title}</Text>
              <Text className="muted tiny">
                {item.specText} × {item.quantity}
              </Text>
            </View>
          ))}
        </View>

        <View className="verify-actions">
          <View className="verify-btn verify-btn--primary" onClick={reset}>
            <Text>继续核销</Text>
          </View>
          <View
            className="verify-btn"
            onClick={() => Taro.navigateBack()}
          >
            <Text>完成</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="page">
      <View className="card">
        <Text className="small">输入顾客的 8 位核销码</Text>
        <Input
          className="verify-input"
          type="number"
          maxlength={8}
          focus={inputFocus}
          value={code}
          placeholder="例如 12345678"
          onInput={(event) => setCode(event.detail.value.replace(/\D/g, ''))}
        />
        <View
          className={`verify-btn verify-btn--primary${busy ? ' is-disabled' : ''}`}
          onClick={() => (busy ? undefined : void submit())}
        >
          <Text>{busy ? '核销中…' : '确认核销'}</Text>
        </View>
      </View>

      <View className="verify-scan" onClick={() => (busy ? undefined : void scan())}>
        <Text className="verify-scan-icon">⌗</Text>
        <Text>扫码核销</Text>
        {isH5 && <Text className="muted tiny">预览环境可拍照 / 选图识别</Text>}
      </View>

      <Text className="muted tiny verify-note">
        核销后订单将变为已完成，顾客会收到自提完成通知。
      </Text>
    </View>
  );
}
