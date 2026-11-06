import { Text, Textarea, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useState } from 'react';

import { api, showError } from '../../../api/client';

import './index.css';

const STAR_VALUES = [1, 2, 3, 4, 5];

export default function Page() {
  const router = useRouter();
  const orderItemId = router.params.orderItemId ?? '';
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!orderItemId) {
      await Taro.showToast({ title: '缺少订单商品信息', icon: 'none' });
      return;
    }
    setSubmitting(true);
    try {
      await api('/reviews', {
        method: 'POST',
        body: {
          orderItemId,
          rating,
          content: content.trim() || undefined,
          anonymous,
        },
      });
      await Taro.showToast({ title: '已提交，审核通过后展示', icon: 'none' });
      setTimeout(() => {
        void Taro.navigateBack();
      }, 800);
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className="page page--bar">
      <View className="card">
        <Text className="section-title review-title">商品评分</Text>
        <View className="review-stars">
          {STAR_VALUES.map((value) => (
            <Text
              key={value}
              className={`review-star${value <= rating ? ' review-star--on' : ''}`}
              onClick={() => setRating(value)}
            >
              {value <= rating ? '★' : '☆'}
            </Text>
          ))}
          <Text className="muted small review-score">{rating} 分</Text>
        </View>
      </View>

      <View className="card">
        <Text className="section-title review-title">评价内容</Text>
        <Textarea
          className="textarea"
          value={content}
          maxlength={500}
          placeholder="说说商品口味、包装和配送体验吧"
          onInput={(e) => setContent(e.detail.value)}
        />
      </View>

      <View className="card row-between">
        <View className="col">
          <Text className="small">匿名评价</Text>
          <Text className="muted tiny">开启后不展示你的昵称</Text>
        </View>
        <View
          className={`review-switch${anonymous ? ' review-switch--on' : ''}`}
          onClick={() => setAnonymous((prev) => !prev)}
        >
          <View className="review-switch-knob" />
        </View>
      </View>

      <View className="bottom-bar">
        <View
          className={`btn btn--primary btn--block${submitting ? ' btn--disabled' : ''}`}
          onClick={submit}
        >
          {submitting ? '提交中…' : '提交评价'}
        </View>
      </View>
    </View>
  );
}
