import { Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';

import { api, showError } from '../../api/client';
import { Empty, Loading, Price, ProductThumb } from '../../components/common';
import { useRequest } from '../../hooks/useRequest';
import { formatDate, money, specText } from '../../utils/format';

import './index.css';

interface Sku {
  id: string;
  spec: Record<string, string> | null;
  priceCents: number;
  originCents: number | null;
  available: number;
  status: string;
}

interface ProductDetail {
  id: string;
  title: string;
  subtitle: string | null;
  detail: string | null;
  mainImageKey: string | null;
  status: string;
  category: string;
  tags: string[];
  skus: Sku[];
  reviewSummary: {
    count: number;
    avgRating: number;
    items: { rating: number; content: string | null; createdAt: string }[];
  };
}

interface ReviewList {
  summary: { count: number; avgRating: number };
  items: {
    id: string;
    rating: number;
    content: string | null;
    createdAt: string;
    specText: string;
    nickname: string;
  }[];
}

function stars(rating: number): string {
  return '★★★★★'.slice(0, rating).padEnd(5, '☆');
}

export default function Page() {
  const router = useRouter();
  const id = router.params.id ?? '';
  const { data: product, loading } = useRequest(() => api<ProductDetail>(`/products/${id}`), [id]);
  const { data: reviewData } = useRequest(() => api<ReviewList>(`/products/${id}/reviews`), [id]);
  const [skuId, setSkuId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!product) return;
    const first = product.skus.find((sku) => sku.available > 0) ?? product.skus[0];
    setSkuId(first?.id ?? '');
    setQuantity(1);
  }, [product]);

  if (loading && !product) return <Loading />;
  if (!product) return <Empty text="商品不存在或已下架" />;

  const sku = product.skus.find((item) => item.id === skuId) ?? product.skus[0];
  const available = sku?.available ?? 0;
  const canBuy = Boolean(sku) && available > 0 && sku?.status === 'ON_SALE';
  const reviews = reviewData?.items.slice(0, 3) ?? [];

  const changeQuantity = (delta: number) => {
    const next = Math.min(Math.max(quantity + delta, 1), Math.max(available, 1));
    setQuantity(next);
  };

  const addToCart = async () => {
    if (!sku || !canBuy) {
      await Taro.showToast({ title: '该规格暂时售罄', icon: 'none' });
      return;
    }
    setSubmitting(true);
    try {
      await api('/cart/items', { method: 'POST', body: { skuId: sku.id, quantity } });
      await Taro.showToast({ title: '已加入购物车', icon: 'success' });
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const buyNow = () => {
    if (!sku || !canBuy) {
      void Taro.showToast({ title: '该规格暂时售罄', icon: 'none' });
      return;
    }
    void Taro.navigateTo({ url: `/pages/checkout/index?skuId=${sku.id}&quantity=${quantity}` });
  };

  return (
    <View className="page page--bar product-page">
      <ProductThumb
        imageKey={product.mainImageKey}
        title={product.title}
        className="product-hero"
      />

      <View className="card">
        <View className="row product-price-row">
          <Price cents={sku?.priceCents ?? 0} />
          {!!sku?.originCents && sku.originCents > sku.priceCents && (
            <Text className="price--old">{money(sku.originCents)}</Text>
          )}
          {product.status !== 'ON_SALE' && <Text className="tag">已下架</Text>}
        </View>
        <Text className="title product-title">{product.title}</Text>
        {product.subtitle && <Text className="muted small product-subtitle">{product.subtitle}</Text>}
        <View className="product-tags">
          <Text className="tag">{product.category}</Text>
          {product.tags.map((tag) => (
            <Text key={tag} className="tag tag--brand">
              {tag}
            </Text>
          ))}
        </View>
      </View>

      <View className="card">
        <Text className="section-title product-flush-title">选择规格</Text>
        <View className="sku-list">
          {product.skus.map((item) => {
            const soldOut = item.available <= 0 || item.status !== 'ON_SALE';
            return (
              <View
                key={item.id}
                className={`sku-chip${item.id === sku?.id ? ' sku-chip--on' : ''}${
                  soldOut ? ' sku-chip--off' : ''
                }`}
                onClick={() => {
                  if (soldOut) return;
                  setSkuId(item.id);
                  setQuantity(1);
                }}
              >
                <Text>{specText(item.spec) || '默认规格'}</Text>
                {soldOut && <Text className="sku-chip-note">售罄</Text>}
              </View>
            );
          })}
        </View>

        <View className="row-between product-qty">
          <Text className="small muted">购买数量</Text>
          <View className="stepper">
            <Text onClick={() => changeQuantity(-1)}>−</Text>
            <Text className="stepper-value">{quantity}</Text>
            <Text onClick={() => changeQuantity(1)}>＋</Text>
          </View>
        </View>
        <Text className="tiny muted">库存 {available} 件</Text>
      </View>

      <View className="card">
        <View className="row-between">
          <Text className="section-title product-flush-title">商品评价</Text>
          <Text className="small muted">
            {product.reviewSummary.count} 条 · {product.reviewSummary.avgRating || '—'} 分
          </Text>
        </View>
        {!reviews.length && <Text className="muted small">暂无评价</Text>}
        {reviews.map((review) => (
          <View key={review.id} className="product-review">
            <View className="row-between">
              <Text className="product-stars">{stars(review.rating)}</Text>
              <Text className="muted tiny">{formatDate(review.createdAt)}</Text>
            </View>
            {review.content && <Text className="small product-review-text">{review.content}</Text>}
            <Text className="muted tiny">
              {review.nickname}
              {review.specText ? ` · ${review.specText}` : ''}
            </Text>
          </View>
        ))}
      </View>

      {product.detail && (
        <View className="card">
          <Text className="section-title product-flush-title">商品详情</Text>
          <Text className="small product-detail">{product.detail}</Text>
        </View>
      )}

      <View className="bottom-bar">
        <View
          className="product-cart-link"
          onClick={() => Taro.switchTab({ url: '/pages/cart/index' })}
        >
          <Text className="product-cart-icon">🛒</Text>
          <Text className="tiny muted">购物车</Text>
        </View>
        <View className="btn btn--ghost grow" onClick={addToCart}>
          {submitting ? '处理中…' : '加入购物车'}
        </View>
        <View className="btn btn--primary grow" onClick={buyNow}>
          立即购买
        </View>
      </View>
    </View>
  );
}
