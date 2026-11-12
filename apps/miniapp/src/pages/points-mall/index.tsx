import { Image, Text, View } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro';
import { useCallback, useRef, useState } from 'react';

import { api, showError } from '../../api/client';
import { Loading, PageState, imageSrc } from '../../components/common';
import { money } from '../../utils/format';

import './index.css';

interface PointsProduct {
  id: string;
  title: string;
  subtitle: string | null;
  mainImageKey: string | null;
  pointsCostMin: number;
  pointsMoneyCentsMin: number;
  stock: number;
  pointsLimitPerUser: number;
  soldCount: number;
  skuCount: number;
}

interface ProductPage {
  total: number;
  page: number;
  pageSize: number;
  items: PointsProduct[];
}

const PAGE_SIZE = 20;

export default function Page() {
  const [items, setItems] = useState<PointsProduct[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(1);
  const loadingRef = useRef(false);

  const loadBalance = useCallback(async () => {
    try {
      const overview = await api<{ balance: number }>('/member/points/overview');
      setBalance(overview.balance);
    } catch (err) {
      showError(err);
    }
  }, []);

  const loadFirst = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const result = await api<ProductPage>('/points-mall/products', {
        query: { page: 1, pageSize: PAGE_SIZE },
      });
      setItems(result.items);
      pageRef.current = 1;
      setHasMore(result.items.length < result.total);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
      loadingRef.current = false;
      void Taro.stopPullDownRefresh();
    }
  }, []);

  useDidShow(() => {
    void loadBalance();
    void loadFirst();
  });

  usePullDownRefresh(() => {
    void loadFirst();
  });

  useReachBottom(() => {
    void loadMore();
  });

  async function loadMore() {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoadingMore(true);
    const next = pageRef.current + 1;
    try {
      const result = await api<ProductPage>('/points-mall/products', {
        query: { page: next, pageSize: PAGE_SIZE },
      });
      setItems((prev) => [...prev, ...result.items]);
      pageRef.current = next;
      setHasMore(next * PAGE_SIZE < result.total);
    } catch (err) {
      showError(err);
    } finally {
      setLoadingMore(false);
      loadingRef.current = false;
    }
  }

  if (loading && !items.length) return <Loading />;

  return (
    <View className="page pointsmall">
      <View className="hero pointsmall-hero">
        <View className="row-between pointsmall-hero-top">
          <Text className="points-label">我的积分</Text>
          <View className="row pointsmall-links">
            <Text
              className="pointsmall-link"
              onClick={() => void Taro.navigateTo({ url: '/pages/points/index' })}
            >
              明细
            </Text>
            <Text
              className="pointsmall-link"
              onClick={() => void Taro.navigateTo({ url: '/pages/orders/index?orderType=POINTS' })}
            >
              我的兑换
            </Text>
          </View>
        </View>
        <Text className="pointsmall-balance">{balance}</Text>
        <Text className="points-note">积分兑换好物 · 兑换单统一包邮</Text>
      </View>

      <PageState loading={false} empty={!items.length} text="积分商品正在上架中">
        <View className="waterfall">
          {items.map((item) => (
            <View
              key={item.id}
              className="waterfall-card"
              onClick={() => void Taro.navigateTo({ url: `/pages/points-product/index?id=${item.id}` })}
            >
              {item.mainImageKey ? (
                <Image className="waterfall-image" src={imageSrc(item.mainImageKey)} mode="widthFix" />
              ) : (
                <View className="waterfall-image waterfall-image--empty">{item.title.slice(0, 1)}</View>
              )}
              <View className="waterfall-body">
                <Text className="waterfall-title">{item.title}</Text>
                <View className="row waterfall-price">
                  <Text className="waterfall-points">{item.pointsCostMin}</Text>
                  <Text className="waterfall-unit">积分</Text>
                  {item.pointsMoneyCentsMin > 0 && (
                    <Text className="waterfall-money">+ {money(item.pointsMoneyCentsMin)}</Text>
                  )}
                </View>
                <View className="row waterfall-meta">
                  <Text className="muted tiny">
                    {item.pointsLimitPerUser > 0 ? `每人限兑 ${item.pointsLimitPerUser} 件` : '不限兑换'}
                  </Text>
                  <Text className="muted tiny">已兑 {item.soldCount}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
        {loadingMore && <View className="pointsmall-more">加载中…</View>}
        {!hasMore && items.length > 0 && <View className="pointsmall-more">没有更多了</View>}
      </PageState>
    </View>
  );
}
