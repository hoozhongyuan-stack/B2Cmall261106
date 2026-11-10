import { View } from '@tarojs/components';
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro';
import { useEffect, useState } from 'react';

import type { MicroPageRelease } from '@shanye/shared/src/microPage';
import { api } from '../../api/client';
import { AppTabBar } from '../../components/AppTabBar';
import { MicroRenderer } from '../../components/MicroRenderer';
import { imageSrc } from '../../components/common';

import './index.css';

export default function MicroPage() {
  const router = useRouter();
  const code = router.params.code ?? '';
  const [page, setPage] = useState<MicroPageRelease | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!code) {
      setFailed(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    api<MicroPageRelease>(`/micro-pages/${encodeURIComponent(code)}`, { auth: 'optional' })
      .then((data) => {
        if (!alive) return;
        setPage(data);
        const navTitle = data.settings?.navTitle || data.title;
        if (navTitle) void Taro.setNavigationBarTitle({ title: navTitle });
      })
      .catch(() => {
        if (alive) setFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [code]);

  useShareAppMessage(() => ({
    title: page?.settings?.shareTitle || page?.title || '山野好物',
    path: `/pages/micro/index?code=${encodeURIComponent(code)}`,
    imageUrl: page?.settings?.shareImageKey ? imageSrc(page.settings.shareImageKey) : undefined,
  }));

  if (loading) {
    return (
      <View className="micro-page">
        <View className="loading">加载中…</View>
      </View>
    );
  }

  if (failed || !page) {
    return (
      <View className="micro-page">
        <View className="empty">页面不存在或已下线</View>
        <AppTabBar />
      </View>
    );
  }

  return (
    <View className="micro-page" style={{ background: page.settings?.bgColor || undefined }}>
      <MicroRenderer components={page.components} />
      <AppTabBar />
    </View>
  );
}
