import { Text, View } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh, useReachBottom, useRouter } from '@tarojs/taro';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, getToken, showError } from '../../api/client';
import { AppTabBar } from '../../components/AppTabBar';
import { CirclePostCard, type CirclePostItem } from '../../components/CirclePostCard';
import { Empty, Loading } from '../../components/common';

import './index.css';

interface Category {
  id: string;
  name: string;
}

interface Topic {
  id: string;
  name: string;
  postCount: number;
}

interface FeedResult {
  items: CirclePostItem[];
  nextCursor: string | null;
  needLogin?: boolean;
}

type Tab = 'recommend' | 'latest' | 'follow';

const TABS: { value: Tab; label: string }[] = [
  { value: 'recommend', label: '推荐' },
  { value: 'latest', label: '最新' },
  { value: 'follow', label: '关注' },
];

export default function Page() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('recommend');
  const [categories, setCategories] = useState<Category[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [categoryId, setCategoryId] = useState(router.params.categoryId ?? '');
  const [topicId, setTopicId] = useState(router.params.topicId ?? '');
  const [items, setItems] = useState<CirclePostItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unread, setUnread] = useState(0);
  const [needLogin, setNeedLogin] = useState(false);
  const requestRef = useRef(0);

  const loadUnread = useCallback(() => {
    if (!getToken()) {
      setUnread(0);
      return;
    }
    api<{ unread: number }>('/circle/notifications')
      .then((result) => setUnread(result.unread))
      .catch(() => setUnread(0));
  }, []);

  const load = useCallback(
    async (nextCursor?: string | null) => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      if (nextCursor) setLoadingMore(true);
      else setLoading(true);
      try {
        const result = await api<FeedResult>('/circle/posts', {
          auth: 'optional',
          query: { tab, categoryId, topicId, cursor: nextCursor ?? undefined, pageSize: 10 },
        });
        if (requestId !== requestRef.current) return;
        setNeedLogin(Boolean(result.needLogin));
        setItems((prev) => (nextCursor ? [...prev, ...result.items] : result.items));
        setCursor(result.nextCursor);
      } catch (err) {
        showError(err);
      } finally {
        if (requestId === requestRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [tab, categoryId, topicId],
  );

  useEffect(() => {
    void (async () => {
      try {
        const [categoryResult, topicResult] = await Promise.all([
          api<{ items: Category[] }>('/circle/categories', { auth: 'optional' }),
          api<{ items: Topic[] }>('/circle/topics', { auth: 'optional' }),
        ]);
        setCategories(categoryResult.items);
        setTopics(topicResult.items);
      } catch (err) {
        showError(err);
      }
    })();
  }, []);

  useEffect(() => {
    setCursor(null);
    setItems([]);
    void load();
  }, [tab, categoryId, topicId]);

  useDidShow(() => {
    loadUnread();
  });

  usePullDownRefresh(() => {
    void load().finally(() => Taro.stopPullDownRefresh());
  });

  useReachBottom(() => {
    if (cursor && !loadingMore && !loading) void load(cursor);
  });

  const goPublish = () => {
    void Taro.navigateTo({ url: '/pages/circle-publish/index' });
  };

  return (
    <View className="page page--flush circle-page">
      <View className="circle-top">
        <View className="circle-top-bar">
          <Text className="circle-top-title">山野圈子</Text>
          <View className="row" style={{ gap: 16 }}>
            <View
              className="circle-top-icon"
              onClick={() => Taro.navigateTo({ url: '/pages/circle-search/index' })}
            >
              <Text>搜索</Text>
            </View>
            <View
              className="circle-top-icon"
              onClick={() => Taro.navigateTo({ url: '/pages/circle-notifications/index' })}
            >
              {unread > 0 && <View className="circle-badge" />}
              <Text>消息</Text>
            </View>
            <View className="circle-top-icon" onClick={() => Taro.navigateTo({ url: '/pages/circle-me/index' })}>
              <Text>我的</Text>
            </View>
            <View className="btn btn--primary circle-publish-btn" onClick={goPublish}>
              发布
            </View>
          </View>
        </View>

        <View className="tabs circle-tabs">
          {TABS.map((item) => (
            <Text
              key={item.value}
              className={`tab${tab === item.value ? ' tab--on' : ''}`}
              onClick={() => setTab(item.value)}
            >
              {item.label}
            </Text>
          ))}
        </View>

        <View className="circle-chips">
          <Text
            className={`circle-chip${categoryId === '' ? ' circle-chip--on' : ''}`}
            onClick={() => setCategoryId('')}
          >
            全部
          </Text>
          {categories.map((item) => (
            <Text
              key={item.id}
              className={`circle-chip${categoryId === item.id ? ' circle-chip--on' : ''}`}
              onClick={() => setCategoryId(item.id === categoryId ? '' : item.id)}
            >
              {item.name}
            </Text>
          ))}
        </View>

        {topics.length > 0 && (
          <View className="circle-topics">
            {topics.map((topic) => (
              <Text
                key={topic.id}
                className={`tag${topicId === topic.id ? ' tag--brand' : ''}`}
                onClick={() => setTopicId(topicId === topic.id ? '' : topic.id)}
              >
                #{topic.name} · {topic.postCount}
              </Text>
            ))}
          </View>
        )}
      </View>

      <View className="circle-feed">
        {loading ? (
          <Loading />
        ) : needLogin ? (
          <Empty text="登录后查看关注的人发布的内容" />
        ) : items.length === 0 ? (
          <Empty text="这里还没有内容，发布第一篇吧" />
        ) : (
          <>
            {items.map((post) => (
              <CirclePostCard key={post.id} post={post} />
            ))}
            {loadingMore && <View className="circle-more">加载中…</View>}
            {!cursor && items.length > 0 && <View className="circle-more">没有更多了</View>}
          </>
        )}
      </View>
      <AppTabBar />
    </View>
  );
}
