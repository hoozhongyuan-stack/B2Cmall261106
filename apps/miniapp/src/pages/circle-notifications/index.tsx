import { Image, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useState } from 'react';

import { api, showError } from '../../api/client';
import { Empty, Loading, imageSrc } from '../../components/common';
import { formatDate } from '../../utils/format';

import './index.css';

interface NotificationItem {
  id: string;
  type: string;
  text: string;
  read: boolean;
  createdAt: string;
  actor: { id: string; nickname: string | null; avatarKey: string | null } | null;
  post: { id: string; excerpt: string; image: string | null } | null;
}

export default function Page() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api<{ unread: number; items: NotificationItem[] }>(
        '/circle/notifications',
      );
      setItems(result.items);
      setUnread(result.unread);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => {
    void load();
  });

  const readAll = async () => {
    if (!unread) return;
    try {
      await api('/circle/notifications/read', { method: 'POST', body: { all: true } });
      setItems((prev) => prev.map((item) => ({ ...item, read: true })));
      setUnread(0);
    } catch (err) {
      showError(err);
    }
  };

  const openItem = async (item: NotificationItem) => {
    if (!item.read) {
      setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, read: true } : row)));
      setUnread((prev) => Math.max(prev - 1, 0));
      api('/circle/notifications/read', { method: 'POST', body: { ids: [item.id] } }).catch(
        () => undefined,
      );
    }
    if (item.post) {
      void Taro.navigateTo({ url: `/pages/circle-detail/index?id=${item.post.id}` });
    } else if (item.actor) {
      void Taro.navigateTo({ url: `/pages/circle-user/index?id=${item.actor.id}` });
    }
  };

  return (
    <View className="page circle-notice">
      <View className="circle-notice-head">
        <Text className="small muted">未读 {unread}</Text>
        <Text className="tiny circle-notice-readall" onClick={() => void readAll()}>
          全部已读
        </Text>
      </View>

      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty text="还没有互动消息" />
      ) : (
        items.map((item) => (
          <View
            key={item.id}
            className={`card circle-notice-item${item.read ? '' : ' circle-notice-item--unread'}`}
            onClick={() => void openItem(item)}
          >
            <View className="circle-notice-avatar">
              {item.actor?.avatarKey ? (
                <Image
                  className="circle-notice-avatar-img"
                  src={imageSrc(item.actor.avatarKey)}
                  mode="aspectFill"
                />
              ) : (
                <Text>{((item.actor?.nickname ?? '山') as string).slice(0, 1)}</Text>
              )}
            </View>
            <View className="grow col">
              <Text className="small">
                {item.actor?.nickname ?? '有人'} {item.text}
              </Text>
              {item.post?.excerpt ? (
                <Text className="muted tiny ellipsis">{item.post.excerpt}</Text>
              ) : null}
              <Text className="muted tiny">{formatDate(item.createdAt, true)}</Text>
            </View>
            {item.post?.image ? (
              <Image className="circle-notice-thumb" src={imageSrc(item.post.image)} mode="aspectFill" />
            ) : null}
            {!item.read && <View className="circle-notice-dot" />}
          </View>
        ))
      )}
    </View>
  );
}
