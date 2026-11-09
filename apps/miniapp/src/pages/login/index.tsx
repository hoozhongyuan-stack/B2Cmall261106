import { Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useState } from 'react';

import { loginWithWechat, saveConsent, showError } from '../../api/client';

import './index.css';

export default function Page() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

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

  return (
    <View className="page login-page">
      <View className="login-brand">
        <View className="login-logo">
          <Text>山</Text>
        </View>
        <Text className="login-title">山野商城</Text>
        <Text className="login-sub">把山野好物送到每一户人家</Text>
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
            <Text className="muted tiny">我已阅读并同意</Text>
            <Text
              className="login-link"
              onClick={(event) => {
                event.stopPropagation();
                openAgreement('terms');
              }}
            >
              《用户协议》
            </Text>
            <Text className="muted tiny">和</Text>
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

        <Text className="muted tiny login-hint">
          未注册的微信号登录后将自动创建账号；我们仅收集提供服务所必需的信息。
        </Text>
      </View>
    </View>
  );
}
