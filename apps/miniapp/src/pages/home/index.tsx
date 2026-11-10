import { Image, ScrollView, Swiper, SwiperItem, Text, View } from '@tarojs/components';
import Taro, { useShareAppMessage } from '@tarojs/taro';
import { useEffect, useState } from 'react';

import type { MicroPageRelease, ShopShell } from '@shanye/shared/src/microPage';
import { api } from '../../api/client';
import { AppTabBar } from '../../components/AppTabBar';
import { MicroRenderer } from '../../components/MicroRenderer';
import { Loading, SectionTitle, imageSrc } from '../../components/common';
import { ProductCard } from '../../components/ProductCard';
import { useRequest } from '../../hooks/useRequest';
import { money } from '../../utils/format';
import { cachedShell, loadShell } from '../../utils/shopShell';

import './index.css';

interface HomeLink {
  linkType: string;
  linkValue: string | null;
}

interface HomeBanner extends HomeLink {
  id: string;
  imageKey: string;
  title: string | null;
}

interface HomeNav extends HomeLink {
  id: string;
  name: string;
  iconKey: string | null;
}

interface HomeProduct {
  id: string;
  title: string;
  subtitle: string | null;
  mainImageKey: string | null;
  priceCents: number;
}

interface HomeSection {
  id: string;
  title: string;
  products: HomeProduct[];
}

interface HomeSeckill {
  promotionId: string;
  promotionName: string;
  endAt: string;
  skuId: string;
  productId: string;
  title: string;
  imageKey: string | null;
  originalPriceCents: number;
  seckillPriceCents: number;
  stockLeft: number;
  limitPerUser: number;
}

interface HomeCategory {
  id: string;
  name: string;
  index: number;
}

interface HomeData {
  freeThresholdCents: number;
  banners: HomeBanner[];
  navs: HomeNav[];
  sections: HomeSection[];
  seckills: HomeSeckill[];
  categories: HomeCategory[];
  picks: HomeProduct[];
}

export default function Page() {
  const { data, loading } = useRequest(() => api<HomeData>('/home', { auth: 'optional' }));
  const [shell, setShell] = useState<ShopShell>(cachedShell());
  const [micro, setMicro] = useState<MicroPageRelease | null>(null);
  const [microLoading, setMicroLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadShell(true).then((result) => {
      if (!alive) return;
      setShell(result);
      if (result.homeRenderer !== 'micro' || !result.homeCode) return;
      setMicroLoading(true);
      void api<MicroPageRelease>(`/micro-pages/${encodeURIComponent(result.homeCode)}`, {
        auth: 'optional',
      })
        .then((page) => {
          if (!alive) return;
          setMicro(page);
          const navTitle = page.settings?.navTitle || page.title;
          if (navTitle) void Taro.setNavigationBarTitle({ title: navTitle });
        })
        .catch(() => undefined)
        .finally(() => {
          if (alive) setMicroLoading(false);
        });
    });
    return () => {
      alive = false;
    };
  }, []);

  useShareAppMessage(() => ({
    title: micro?.settings?.shareTitle || micro?.title || '山野好物 · 顺时而食',
    path: '/pages/home/index',
    imageUrl: micro?.settings?.shareImageKey ? imageSrc(micro.settings.shareImageKey) : undefined,
  }));

  if (shell.homeRenderer === 'micro' && shell.homeCode) {
    return (
      <View className="page page--flush">
        {micro ? (
          <View style={{ background: micro.settings?.bgColor || undefined, minHeight: '100vh' }}>
            <MicroRenderer components={micro.components} />
          </View>
        ) : (
          <Loading text={microLoading ? '页面加载中…' : '页面暂不可用'} />
        )}
        <AppTabBar />
      </View>
    );
  }

  const goSearch = () => {
    void Taro.navigateTo({ url: '/pages/search/index' });
  };

  const openLink = (link: HomeLink) => {
    const value = link.linkValue;
    if (!value) return;
    if (link.linkType === 'product') {
      void Taro.navigateTo({ url: `/pages/product/index?id=${value}` });
    } else if (link.linkType === 'category') {
      void Taro.navigateTo({ url: `/pages/category/index?categoryId=${value}` });
    } else if (link.linkType === 'search') {
      void Taro.navigateTo({ url: `/pages/search/index?keyword=${encodeURIComponent(value)}` });
    } else if (link.linkType === 'page') {
      void Taro.navigateTo({ url: value });
    }
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
            {data.banners.length > 0 && (
              <Swiper
                className="home-banner-swiper"
                indicatorDots
                autoplay
                circular
                interval={4000}
                indicatorColor="rgba(255,255,255,0.45)"
                indicatorActiveColor="rgba(255,255,255,1)"
              >
                {data.banners.map((banner) => (
                  <SwiperItem key={banner.id}>
                    <View className="home-banner" onClick={() => openLink(banner)}>
                      <Image
                        className="home-banner-image"
                        src={imageSrc(banner.imageKey)}
                        mode="aspectFill"
                      />
                      {banner.title && <Text className="home-banner-title">{banner.title}</Text>}
                    </View>
                  </SwiperItem>
                ))}
              </Swiper>
            )}

            {data.navs.length > 0 ? (
              <View className="home-cats">
                {data.navs.map((nav) => (
                  <View key={nav.id} className="home-cat" onClick={() => openLink(nav)}>
                    {nav.iconKey ? (
                      <Image className="home-nav-icon" src={imageSrc(nav.iconKey)} mode="aspectFill" />
                    ) : (
                      <View className="home-cat-badge">
                        <Text>{nav.name.slice(0, 1)}</Text>
                      </View>
                    )}
                    <Text className="home-cat-name ellipsis">{nav.name}</Text>
                  </View>
                ))}
              </View>
            ) : (
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
            )}

            {data.seckills.length > 0 && (
              <View className="home-section">
                <SectionTitle>限时秒杀</SectionTitle>
                <ScrollView className="home-seckill-row" scrollX enhanced showScrollbar={false}>
                  <View className="home-seckill-inner">
                    {data.seckills.map((item) => (
                      <View
                        key={`${item.promotionId}-${item.skuId}`}
                        className="home-seckill-card"
                        onClick={() =>
                          Taro.navigateTo({ url: `/pages/product/index?id=${item.productId}` })
                        }
                      >
                        <Image
                          className="home-seckill-image"
                          src={imageSrc(item.imageKey ?? '')}
                          mode="aspectFill"
                        />
                        <Text className="home-seckill-title ellipsis">{item.title}</Text>
                        <View className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                          <Text className="price">{money(item.seckillPriceCents)}</Text>
                          <Text className="muted tiny home-seckill-origin">
                            {money(item.originalPriceCents)}
                          </Text>
                        </View>
                        <Text className="muted tiny">仅剩 {item.stockLeft} 件</Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {data.sections.length > 0 ? (
              data.sections.map((section) => (
                <View key={section.id} className="home-section">
                  <SectionTitle>{section.title}</SectionTitle>
                  {section.products.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={{
                        id: product.id,
                        title: product.title,
                        subtitle: product.subtitle,
                        mainImageKey: product.mainImageKey,
                        priceMinCents: product.priceCents,
                      }}
                    />
                  ))}
                  {!section.products.length && <View className="empty">该推荐位暂无商品</View>}
                </View>
              ))
            ) : (
              <>
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
          </>
        )}
      </View>
      <AppTabBar />
    </View>
  );
}
