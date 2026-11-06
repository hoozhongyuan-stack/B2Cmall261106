import { Text, View } from '@tarojs/components';
import { useDidShow } from '@tarojs/taro';
import { useState } from 'react';

import { api, showError } from '../../../api/client';
import { Empty, Loading, ProductThumb } from '../../../components/common';
import { formatDate } from '../../../utils/format';

import './index.css';

interface MyReview {
  id: string;
  rating: number;
  content: string | null;
  images: string[];
  anonymous: boolean;
  status: string;
  reply: string | null;
  createdAt: string;
  item: { title: string; specText: string; imageKey: string | null } | null;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: '待审核',
  SHOWN: '已展示',
  HIDDEN: '已隐藏',
};

function stars(rating: number): string {
  return '★★★★★'.slice(0, rating).padEnd(5, '☆');
}

export default function Page() {
  const [items, setItems] = useState<MyReview[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await api<{ items: MyReview[] }>('/reviews/mine');
      setItems(res.items);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => {
    void load();
  });

  if (loading && !items.length) return <Loading />;

  return (
    <View className="page">
      {!items.length && <Empty text="还没有发表过评价" />}
      {items.map((review) => (
        <View key={review.id} className="card mr-card">
          <View className="row-between">
            <Text className="mr-stars">{stars(review.rating)}</Text>
            <Text className={`tag${review.status === 'SHOWN' ? ' tag--brand' : ''}`}>
              {STATUS_LABEL[review.status] ?? review.status}
            </Text>
          </View>

          {review.item && (
            <View className="row mr-item">
              <ProductThumb
                imageKey={review.item.imageKey}
                title={review.item.title}
                className="thumb mr-thumb"
              />
              <View className="grow col">
                <Text className="small clamp-2">{review.item.title}</Text>
                <Text className="muted tiny">{review.item.specText}</Text>
              </View>
            </View>
          )}

          {review.content && <Text className="small mr-content">{review.content}</Text>}

          {!!review.images.length && (
            <View className="mr-images">
              {review.images.map((key) => (
                <ProductThumb key={key} imageKey={key} title="评价图片" className="mr-image" />
              ))}
            </View>
          )}

          <View className="row-between mr-foot">
            <Text className="muted tiny">
              {formatDate(review.createdAt, true)}
              {review.anonymous ? ' · 匿名' : ''}
            </Text>
          </View>

          {review.reply && (
            <View className="card--flat mr-reply">
              <Text className="tiny muted">商家回复</Text>
              <Text className="small">{review.reply}</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}
