import { Input, Text, View } from '@tarojs/components';
import Taro, { useReachBottom } from '@tarojs/taro';
import { useState } from 'react';

import { api, showError } from '../../api/client';
import { CirclePostCard, type CirclePostItem } from '../../components/CirclePostCard';
import { Empty, Loading } from '../../components/common';

import './index.css';

interface TopicHit {
  id: string;
  name: string;
  postCount: number;
}

interface SearchResult {
  items: CirclePostItem[];
  topics: TopicHit[];
  nextCursor: string | null;
}

export default function Page() {
  const [keyword, setKeyword] = useState('');
  const [applied, setApplied] = useState('');
  const [topics, setTopics] = useState<TopicHit[]>([]);
  const [items, setItems] = useState<CirclePostItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = async (nextCursor?: string | null) => {
    const word = nextCursor ? applied : keyword.trim();
    if (!word) {
      await Taro.showToast({ title: '请输入搜索关键词', icon: 'none' });
      return;
    }
    if (nextCursor) setLoadingMore(true);
    else setLoading(true);
    try {
      const result = await api<SearchResult>('/circle/search', {
        auth: 'optional',
        query: { keyword: word, cursor: nextCursor ?? undefined, pageSize: 10 },
      });
      if (!nextCursor) {
        setApplied(word);
        setTopics(result.topics);
      }
      setItems((prev) => (nextCursor ? [...prev, ...result.items] : result.items));
      setCursor(result.nextCursor);
      setSearched(true);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useReachBottom(() => {
    if (cursor && !loadingMore && !loading) void search(cursor);
  });

  return (
    <View className="page circle-search">
      <View className="row circle-search-bar">
        <Input
          className="input grow"
          value={keyword}
          placeholder="搜索内容或话题"
          confirmType="search"
          focus
          onInput={(e) => setKeyword(e.detail.value)}
          onConfirm={() => void search()}
        />
        <View className="btn btn--primary circle-search-btn" onClick={() => void search()}>
          搜索
        </View>
      </View>

      {loading ? (
        <Loading />
      ) : !searched ? (
        <Empty text="搜索感兴趣的内容与话题" />
      ) : (
        <>
          {topics.length > 0 && (
            <View className="card circle-search-topics">
              <Text className="section-title circle-search-title">相关话题</Text>
              <View className="circle-search-chips">
                {topics.map((topic) => (
                  <Text
                    key={topic.id}
                    className="tag tag--brand"
                    onClick={() =>
                      Taro.navigateTo({
                        url: `/pages/circle/index?topicId=${encodeURIComponent(topic.id)}`,
                      })
                    }
                  >
                    #{topic.name} · {topic.postCount}
                  </Text>
                ))}
              </View>
            </View>
          )}

          {items.length === 0 ? (
            <Empty text={`没有找到与「${applied}」相关的内容`} />
          ) : (
            items.map((post) => <CirclePostCard key={post.id} post={post} />)
          )}
          {loadingMore && <View className="circle-search-more">加载中…</View>}
          {!cursor && items.length > 0 && (
            <View className="circle-search-more">没有更多了</View>
          )}
        </>
      )}
    </View>
  );
}
