import { View } from '@tarojs/components';
import Taro, { useShareAppMessage } from '@tarojs/taro';
import { useEffect, useState } from 'react';

import type { MicroPageRelease } from '@shanye/shared/src/microPage';
import { api } from '../../api/client';
import { AppTabBar } from '../../components/AppTabBar';
import { MicroRenderer } from '../../components/MicroRenderer';
import { PopupAd } from '../../components/PopupAd';
import { PageState, imageSrc } from '../../components/common';
import { loadShell } from '../../utils/shopShell';

import './index.css';

/**
 * 首页完全由微页面渲染：取后台「已设首页」的已上线页面；
 * 未配置时不回退旧版首页，直接展示引导空态。
 */
export default function Page() {
  const [micro, setMicro] = useState<MicroPageRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void loadShell(true).then((result) => {
      if (!alive) return;
      if (!result.homeCode) {
        setLoading(false);
        setError('首页尚未配置');
        return;
      }
      void api<MicroPageRelease>(`/micro-pages/${encodeURIComponent(result.homeCode)}`, {
        auth: 'optional',
      })
        .then((page) => {
          if (!alive) return;
          setMicro(page);
          setError('');
          const navTitle = page.settings?.navTitle || page.title;
          if (navTitle) void Taro.setNavigationBarTitle({ title: navTitle });
        })
        .catch(() => {
          if (alive) setError('首页暂不可用');
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    });
    return () => {
      alive = false;
    };
  }, []);

  useShareAppMessage(() => ({
    title: micro?.settings?.shareTitle || micro?.title || '山野好物 · 顺时而食',
    path: '/pages/home/index',
    imageUrl: micro?.settings?.shareImageKey ? imageSrc(micro.settings.shareImageKey) : undefined,
  }));

  return (
    <View className="page page--flush">
      {micro ? (
        <View style={{ background: micro.settings?.bgColor || undefined, minHeight: '100vh' }}>
          <MicroRenderer components={micro.components} />
        </View>
      ) : (
        <PageState
          loading={loading}
          empty
          text={`${error || '首页暂不可用'}，请前往后台「装修 → 页面装修」创建并上线首页页面`}
        />
      )}
      <AppTabBar />
      <PopupAd />
    </View>
  );
}
