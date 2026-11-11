import { Image, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';

import { api, loginWithWechat, saveConsent, showError } from '../../api/client';
import { imageSrc } from '../../components/common';

import './index.css';

interface ShopInfo {
  shopName: string;
  intro: string;
  logoKey: string | null;
}

export default function Page() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [shop, setShop] = useState<ShopInfo>({ shopName: '', intro: '', logoKey: null });

  useEffect(() => {
    let alive = true;
    void api<ShopInfo>('/shop', { auth: 'optional' })
      .then((data) => {
        if (!alive) return;
        setShop({
          shopName: data.shopName || '山野商城',
          intro: data.intro || '',
          logoKey: data.logoKey ?? null,
        });
        if (data.shopName) void Taro.setNavigationBarTitle({ title: data.shopName });
      })
      .catch(() => {
        if (alive) setShop((prev) => ({ ...prev, shopName: prev.shopName || '山野商城' }));
      });
    return () => {
      alive = false;
    };
  }, []);

  const openAgreement = (type: 'terms' | 'privacy') => {
    void Taro.navigateTo({ url: `/pages/agreement/index?type=${type}` });
  };

  const submit = async () => {
    if (!agreed) {
      await Taro.showToast({ title: '请先阅读并同意协议', icon: 'none' });
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      await loginWithWechat({ agreed: true });
      saveConsent();
      await Taro.showToast({ title: '登录成功', icon: 'success' });
      const redirect = router.params.redirect ? decodeURIComponent(router.params.redirect) : '';
      await Taro.reLaunch({ url: redirect || '/pages/home/index' });
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  const initial = shop.shopName.slice(0, 1) || '山';

  return (
    <View className="login-page">
      <View className="login-deco login-deco-a" />
      <View className="login-deco login-deco-b" />

      <View className="login-brand">
        <View className="login-logo-shell">
          {shop.logoKey ? (
            <Image className="login-logo-img" src={imageSrc(shop.logoKey)} mode="aspectFill" />
          ) : (
            <Text className="login-logo-letter">{initial}</Text>
          )}
        </View>
        <Text className="login-title">{shop.shopName || ' '}</Text>
        <Text className="login-sub">{shop.intro || '山野好物 · 顺时而食'}</Text>
      </View>

      <View className="login-panel">
        <View
          className={`login-btn${loading ? ' is-disabled' : ''}`}
          onClick={() => (loading ? undefined : void submit())}
        >
          <Text>{loading ? '登录中…' : '微信一键登录'}</Text>
        </View>

        <View className="login-agree" onClick={() => setAgreed((prev) => !prev)}>
          <View className={`login-check${agreed ? ' on' : ''}`}>
            {agreed && <Text className="login-check-mark">✓</Text>}
          </View>
          <View className="login-agree-text">
            <Text className="login-muted">我已阅读并同意</Text>
            <Text
              className="login-link"
              onClick={(event) => {
                event.stopPropagation();
                openAgreement('terms');
              }}
            >
              《用户协议》
            </Text>
            <Text className="login-muted">和</Text>
            <Text
              className="login-link"
              onClick={(event) => {
                event.stopPropagation();
                openAgreement('privacy');
              }}
            >
              《隐私政策》
            </Text>
          </View>
        </View>

        <Text className="login-hint">
          未注册的微信号登录后将自动创建账号；我们仅收集提供服务所必需的信息。
        </Text>
      </View>
    </View>
  );
}
