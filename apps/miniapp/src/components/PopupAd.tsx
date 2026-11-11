import { Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';

import { POPUP_AD_SEEN_KEY, type PopupAdSeen } from '@shanye/shared/src/popupAd';
import type { MicroLink } from '@shanye/shared/src/microPage';
import { api } from '../api/client';
import { imageSrc } from './common';
import { openMicroLink } from '../utils/microLink';

import './PopupAd.css';

interface PopupAdItem {
  id: string;
  name: string;
  imageKey: string;
  alt: string | null;
  link: MicroLink;
}

interface ActiveResult {
  ads: PopupAdItem[];
  serverDate: string;
}

function readSeen(serverDate: string): PopupAdSeen {
  const cached = Taro.getStorageSync<PopupAdSeen | ''>(POPUP_AD_SEEN_KEY);
  if (cached && typeof cached === 'object' && cached.date === serverDate) {
    return { date: cached.date, adIds: Array.isArray(cached.adIds) ? cached.adIds : [] };
  }
  return { date: serverDate, adIds: [] };
}

function markSeen(serverDate: string, adId: string) {
  const seen = readSeen(serverDate);
  if (!seen.adIds.includes(adId)) {
    seen.adIds.push(adId);
    Taro.setStorageSync(POPUP_AD_SEEN_KEY, seen);
  }
}

/**
 * 首页弹窗广告：每条每天一次，多条按优先级依次弹出。
 * 实际展示即记为今日已看；点击图片跳转后停止本次会话的剩余队列。
 */
export function PopupAd() {
  const [queue, setQueue] = useState<PopupAdItem[]>([]);
  const [serverDate, setServerDate] = useState('');
  const [failedId, setFailedId] = useState('');

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const result = await api<ActiveResult>('/popup-ad/active', { auth: 'optional' });
        if (!alive) return;
        const seen = readSeen(result.serverDate);
        const list = result.ads.filter((ad) => !seen.adIds.includes(ad.id));
        setServerDate(result.serverDate);
        if (!list.length) return;
        // 首屏渲染后稍作延迟，避免与首页数据加载抢资源
        setTimeout(() => {
          if (!alive) return;
          setQueue(list);
          markSeen(result.serverDate, list[0].id);
        }, 400);
      } catch {
        /* 弹窗加载失败不影响首页 */
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, []);

  const current = queue[0];
  if (!current) return null;

  function closeCurrent() {
    const rest = queue.slice(1);
    setQueue([]);
    if (!rest.length) return;
    // 两张之间留 200ms 间隔，避免视觉上粘连
    setTimeout(() => {
      markSeen(serverDate, rest[0].id);
      setQueue(rest);
    }, 200);
  }

  function openAd() {
    const link = current?.link;
    if (link && link.type !== 'none') {
      // 跳转后本次会话不再继续弹剩余广告
      setQueue([]);
      void openMicroLink(link);
    }
  }

  return (
    <View className="popup-ad-mask" onClick={() => undefined}>
      <View className="popup-ad-card">
        <View className="popup-ad-image-wrap" onClick={openAd}>
          <Image
            className="popup-ad-image"
            src={imageSrc(current.imageKey)}
            mode="aspectFill"
            onError={() => setFailedId(current.id)}
          />
          {current.alt && failedId === current.id && (
            <Text className="popup-ad-alt">{current.alt}</Text>
          )}
        </View>
        <View className="popup-ad-close" onClick={closeCurrent}>
          <Text>×</Text>
        </View>
      </View>
    </View>
  );
}
