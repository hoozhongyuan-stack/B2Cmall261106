import { Image, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useState } from 'react';

import { api, showError } from '../../api/client';
import { Empty, imageSrc, Loading } from '../../components/common';
import { formatDate } from '../../utils/format';

import './index.css';

interface MyPost {
  id: string;
  content: string;
  images: string[];
  status: string;
  auditNote: string | null;
  category: { id: string; name: string };
  topics: { id: string; name: string }[];
  likeCount: number;
  commentCount: number;
  createdAt: string;
}

const TABS = [
  { value: '', label: '全部' },
  { value: 'PENDING', label: '待审核' },
  { value: 'PUBLISHED', label: '已发布' },
  { value: 'REJECTED', label: '已拒绝' },
  { value: 'HIDDEN', label: '已隐藏' },
];

const STATUS_META: Record<string, { label: string; className: string }> = {
  PENDING: { label: '待审核', className: 'tag tag--gold' },
  PUBLISHED: { label: '已发布', className: 'tag tag--brand' },
  REJECTED: { label: '已拒绝', className: 'tag circle-status--rejected' },
  HIDDEN: { label: '已隐藏', className: 'tag' },
};

export default function Page() {
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<MyPost[]>([]);
  const [loading, setLoading] = useState(true);

  useDidShow(() => {
    void (async () => {
      setLoading(true);
      try {
        const result = await api<{ items: MyPost[] }>('/circle/me/posts', {
          query: status ? { status } : {},
        });
        setItems(result.items);
      } catch (err) {
        showError(err);
      } finally {
        setLoading(false);
      }
    })();
  });

  return (
    <View className="page">
      <View className="tabs circle-tabs">
        {TABS.map((tab) => (
          <Text
            key={tab.value}
            className={`tab${tab.value === status ? ' tab--on' : ''}`}
            onClick={() => setStatus(tab.value)}
          >
            {tab.label}
          </Text>
        ))}
      </View>

      <View
        className="btn btn--primary btn--block circle-publish"
        onClick={() => Taro.navigateTo({ url: '/pages/circle-publish/index' })}
      >
        发布内容
      </View>

      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty text="还没有发布过内容，去分享第一篇吧" />
      ) : (
        items.map((post) => {
          const meta = STATUS_META[post.status] ?? { label: post.status, className: 'tag' };
          return (
            <View key={post.id} className="card circle-post">
              <View className="row-between">
                <Text className="small muted">
                  {post.category.name}
                  {post.topics.length > 0
                    ? ` · ${post.topics.map((topic) => `#${topic.name}`).join(' ')}`
                    : ''}
                </Text>
                <Text className={meta.className}>{meta.label}</Text>
              </View>

              {post.content ? <Text className="circle-content">{post.content}</Text> : null}

              {post.images.length > 0 && (
                <View className="circle-thumbs">
                  {post.images.slice(0, 3).map((key) => (
                    <Image
                      key={key}
                      className="circle-thumb"
                      src={imageSrc(key)}
                      mode="aspectFill"
                    />
                  ))}
                  {post.images.length > 3 && (
                    <View className="circle-thumb circle-thumb--more">
                      +{post.images.length - 3}
                    </View>
                  )}
                </View>
              )}

              {post.auditNote ? (
                <Text className="tiny circle-note">审核说明：{post.auditNote}</Text>
              ) : null}

              <View className="row-between circle-meta">
                <Text className="muted tiny">{formatDate(post.createdAt, true)}</Text>
                <Text className="muted tiny">
                  点赞 {post.likeCount} · 评论 {post.commentCount}
                </Text>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}
