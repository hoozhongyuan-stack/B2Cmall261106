import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';

import { api } from '../../api/client';
import { Loading, SectionTitle } from '../../components/common';
import { ProductCard } from '../../components/ProductCard';
import { useRequest } from '../../hooks/useRequest';
import { money } from '../../utils/format';

import './index.css';

interface HomeCategory {
  id: string;
  name: string;
  index: number;
}

interface HomePick {
  id: string;
  title: string;
  subtitle: string | null;
  mainImageKey: string | null;
  priceCents: number;
}

interface HomeData {
  freeThresholdCents: number;
  categories: HomeCategory[];
  picks: HomePick[];
}

export default function Page() {
  const { data, loading } = useRequest(() => api<HomeData>('/home'));

  const goSearch = () => {
    void Taro.navigateTo({ url: '/pages/search/index' });
  };

  return (
    <View className="page page--flush">
      <View className="hero home-hero">
        <Text className="home-brand">山野</Text>
        <Text className="home-slogan">山野好物 · 顺时而食</Text>
        <View className="home-search" onClick={goSearch}>
          <Text className="home-search-icon">⌕</Text>
          <Text>搜索山野好物</Text>
        </View>
      </View>

      <View className="home-body">
        {data && (
          <View className="home-shipping">
            <Text className="tag tag--brand">包邮</Text>
            <Text className="muted small grow">
              满 {money(data.freeThresholdCents)} 免运费，偏远地区除外
            </Text>
          </View>
        )}

        {loading && !data && <Loading />}

        {data && (
          <>
            <View className="home-cats">
              {data.categories.map((cat) => (
                <View
                  key={cat.id}
                  className="home-cat"
                  onClick={() =>
                    Taro.navigateTo({ url: `/pages/category/index?categoryId=${cat.id}` })
                  }
                >
                  <View className="home-cat-badge">
                    <Text>{cat.index}</Text>
                  </View>
                  <Text className="home-cat-name ellipsis">{cat.name}</Text>
                </View>
              ))}
            </View>

            <SectionTitle>精选好物</SectionTitle>
            {data.picks.map((pick) => (
              <ProductCard
                key={pick.id}
                product={{
                  id: pick.id,
                  title: pick.title,
                  subtitle: pick.subtitle,
                  mainImageKey: pick.mainImageKey,
                  priceMinCents: pick.priceCents,
                }}
              />
            ))}
            {!data.picks.length && <View className="empty">暂无精选商品</View>}
          </>
        )}
      </View>
    </View>
  );
}
