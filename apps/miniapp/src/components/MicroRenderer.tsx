import { Image, ScrollView, Swiper, SwiperItem, Text, Video, View } from '@tarojs/components';
import { useEffect, useState } from 'react';

import { tokens } from '@shanye/tokens';
import type { MicroComponent } from '@shanye/shared/src/microPage';
import { api } from '../api/client';
import { imageSrc } from './common';
import { money } from '../utils/format';
import { openMicroLink } from '../utils/microLink';

import './MicroRenderer.css';

type P = Record<string, unknown>;

interface GoodsItem {
  id: string;
  title: string;
  mainImageKey: string | null;
  priceCents: number;
  originPriceCents?: number;
  soldCount?: number;
  tag?: string;
}

interface ApiProduct {
  id: string;
  title: string;
  mainImageKey: string | null;
  priceMinCents: number;
  priceMaxCents?: number;
  soldCount?: number;
}

function toGoodsItem(item: ApiProduct): GoodsItem {
  return {
    id: item.id,
    title: item.title,
    mainImageKey: item.mainImageKey,
    priceCents: item.priceMinCents ?? 0,
    originPriceCents:
      item.priceMaxCents && item.priceMaxCents > (item.priceMinCents ?? 0)
        ? item.priceMaxCents
        : undefined,
    soldCount: item.soldCount,
  };
}

const RATIO_HEIGHT: Record<string, number> = {
  '16:9': 211,
  '4:3': 281,
  '3:2': 250,
  '2:1': 188,
  '1:1': 375,
};

function propsOf(component: MicroComponent): P {
  return (component.props ?? {}) as P;
}

function listOf(value: unknown): P[] {
  return Array.isArray(value)
    ? value.filter((item): item is P => Boolean(item) && typeof item === 'object')
    : [];
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function spacing(component: MicroComponent) {
  const style = component.style ?? {};
  const margin = style.margin ?? [0, 0, 0, 0];
  const padding = style.padding ?? [0, 0, 0, 0];
  return {
    marginTop: `${margin[0] ?? 0}px`,
    marginRight: `${margin[1] ?? 0}px`,
    marginBottom: `${margin[2] ?? 0}px`,
    marginLeft: `${margin[3] ?? 0}px`,
    paddingTop: `${padding[0] ?? 0}px`,
    paddingRight: `${padding[1] ?? 0}px`,
    paddingBottom: `${padding[2] ?? 0}px`,
    paddingLeft: `${padding[3] ?? 0}px`,
    background: style.bgColor || undefined,
    borderRadius: style.radius ? `${style.radius}px` : undefined,
  } as const;
}

/* ---------------- 商品组件 ---------------- */

function GoodsBlock({ component }: { component: MicroComponent }) {
  const props = propsOf(component);
  const source = str(props.source, 'picks');
  const limit = Math.max(1, Math.min(num(props.limit, 6), 50));
  const [items, setItems] = useState<GoodsItem[]>([]);
  const [loading, setLoading] = useState(true);

  const key = JSON.stringify([source, props.productIds, props.categoryId, props.promotionId, limit]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    async function load() {
      try {
        if (source === 'seckill') {
          const result = await api<{ items: { promotionId: string; productId: string; title: string; imageKey: string | null; originalPriceCents: number; seckillPriceCents: number; stockLeft: number }[] }>(
            '/promotions/seckill',
            { auth: 'optional' },
          );
          const promotionId = str(props.promotionId);
          const rows = result.items
            .filter((item) => !promotionId || item.promotionId === promotionId)
            .slice(0, limit)
            .map((item) => ({
              id: item.productId,
              title: item.title,
              mainImageKey: item.imageKey,
              priceCents: item.seckillPriceCents,
              originPriceCents: item.originalPriceCents,
              tag: `仅剩 ${item.stockLeft} 件`,
            }));
          if (alive) setItems(rows);
          return;
        }

        if (source === 'manual') {
          const ids = Array.isArray(props.productIds)
            ? props.productIds.filter((id): id is string => typeof id === 'string')
            : [];
          if (!ids.length) {
            if (alive) setItems([]);
            return;
          }
          const result = await api<{ items: ApiProduct[] }>('/products', {
            auth: 'optional',
            query: { ids: ids.join(','), pageSize: limit },
          });
          if (alive) setItems(result.items.map(toGoodsItem));
          return;
        }

        const query: Record<string, string | number> = { pageSize: limit };
        if (source === 'category' && props.categoryId) query.categoryId = str(props.categoryId);
        const result = await api<{ items: ApiProduct[] }>('/products', {
          auth: 'optional',
          query,
        });
        if (alive) setItems((result.items ?? []).map(toGoodsItem));
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [key]);

  const layout = str(props.layout, 'grid-2');
  const show = (props.show ?? {}) as Record<string, boolean>;

  if (loading) return <View className="micro-goods-loading">商品加载中…</View>;
  if (!items.length) return <View className="micro-goods-loading">暂无商品</View>;

  if (layout === 'scroll-x') {
    return (
      <ScrollView className="micro-goods-scroll" scrollX enhanced showScrollbar={false}>
        <View className="micro-goods-scroll-inner">
          {items.map((item) => (
            <View
              key={item.id}
              className="micro-goods-scroll-card"
              onClick={() => void openMicroLink({ type: 'product', value: item.id })}
            >
              <Image className="micro-goods-image" src={imageSrc(item.mainImageKey ?? '')} mode="aspectFill" />
              <Text className="micro-goods-title ellipsis">{item.title}</Text>
              <View className="micro-goods-price-row">
                <Text className="price">{money(item.priceCents)}</Text>
                {show.originPrice !== false && item.originPriceCents ? (
                  <Text className="micro-goods-origin">{money(item.originPriceCents)}</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }

  if (layout === 'list') {
    return (
      <View className="micro-goods-list">
        {items.map((item) => (
          <View
            key={item.id}
            className="micro-goods-row"
            onClick={() => void openMicroLink({ type: 'product', value: item.id })}
          >
            <Image className="micro-goods-row-image" src={imageSrc(item.mainImageKey ?? '')} mode="aspectFill" />
            <View className="micro-goods-row-body">
              <Text className="micro-goods-row-title">{item.title}</Text>
              {show.sales && item.soldCount !== undefined && (
                <Text className="micro-goods-sales">已售 {item.soldCount}</Text>
              )}
              <View className="micro-goods-price-row">
                <Text className="price">{money(item.priceCents)}</Text>
                {show.originPrice !== false && item.originPriceCents ? (
                  <Text className="micro-goods-origin">{money(item.originPriceCents)}</Text>
                ) : null}
                {show.tag && item.tag ? <Text className="micro-goods-tag">{item.tag}</Text> : null}
              </View>
            </View>
          </View>
        ))}
      </View>
    );
  }

  const columns = layout === 'grid-3' ? 3 : 2;
  return (
    <View className={`micro-goods-grid micro-goods-grid-${columns}`}>
      {items.map((item) => (
        <View
          key={item.id}
          className="micro-goods-card"
          onClick={() => void openMicroLink({ type: 'product', value: item.id })}
        >
          <Image className="micro-goods-image" src={imageSrc(item.mainImageKey ?? '')} mode="aspectFill" />
          <View className="micro-goods-body">
            <Text className="micro-goods-title">{item.title}</Text>
            <View className="micro-goods-price-row">
              <Text className="price">{money(item.priceCents)}</Text>
              {show.originPrice !== false && item.originPriceCents ? (
                <Text className="micro-goods-origin">{money(item.originPriceCents)}</Text>
              ) : null}
            </View>
            {show.tag && item.tag ? <Text className="micro-goods-tag">{item.tag}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/* ---------------- 单个组件 ---------------- */

function MicroComponentView({ component }: { component: MicroComponent }) {
  const props = propsOf(component);
  const box = spacing(component);

  switch (component.type) {
    case 'notice': {
      const scroll = props.scroll !== false;
      return (
        <View className="micro-notice" style={box}>
          {str(props.tag) ? <Text className="micro-notice-tag">{str(props.tag)}</Text> : null}
          <View className="micro-notice-body">
            <Text
              className={scroll ? 'micro-notice-text micro-notice-marquee' : 'micro-notice-text'}
              style={{
                color: str(props.textColor) || undefined,
                animationDuration: `${Math.max(6, 600 / Math.max(30, num(props.speed, 80)))}s`,
              }}
            >
              {str(props.text)}
            </Text>
          </View>
        </View>
      );
    }
    case 'search': {
      const shape = str(props.shape, 'capsule');
      const rawLink = (props.link ?? null) as { type?: string; value?: string } | null;
      const link =
        rawLink && rawLink.type && rawLink.type !== 'none'
          ? rawLink
          : { type: 'page', value: '/pages/search/index' };
      return (
        <View style={box}>
          <View
            className={`micro-search micro-search-${shape}`}
            style={{
              background: str(props.bgColor) || 'rgba(255,255,255,0.92)',
              color: str(props.textColor) || undefined,
            }}
            onClick={() => void openMicroLink(link as never)}
          >
            <Text className="micro-search-icon">⌕</Text>
            <Text>{str(props.placeholder, '搜索山野好物')}</Text>
          </View>
          {props.showHotwords === true && Array.isArray(props.hotwords) && props.hotwords.length > 0 && (
            <View className="micro-hotwords">
              {props.hotwords.map((word) => (
                <Text
                  key={String(word)}
                  className="micro-hotword"
                  onClick={() => void openMicroLink({ type: 'search', value: String(word) })}
                >
                  {String(word)}
                </Text>
              ))}
            </View>
          )}
        </View>
      );
    }
    case 'banner': {
      const items = listOf(props.items);
      if (!items.length) return null;
      const height = RATIO_HEIGHT[str(props.ratio, '2:1')] ?? 188;
      return (
        <View style={box}>
          <Swiper
            className="micro-banner"
            style={{ height: `${height}px` }}
            indicatorDots={str(props.indicator, 'dots') === 'dots'}
            indicatorColor="rgba(255,255,255,0.45)"
            indicatorActiveColor={tokens.color.surface}
            autoplay={props.autoplay !== false}
            circular
            interval={Math.max(2, num(props.interval, 4)) * 1000}
          >
            {items.map((item, index) => (
              <SwiperItem key={index}>
                <View
                  className="micro-banner-item"
                  onClick={() => void openMicroLink((item.link ?? null) as never)}
                >
                  <Image className="micro-banner-image" src={imageSrc(str(item.imageKey))} mode="aspectFill" />
                  {str(item.title) && <Text className="micro-banner-title">{str(item.title)}</Text>}
                </View>
              </SwiperItem>
            ))}
          </Swiper>
        </View>
      );
    }
    case 'imageHotspot': {
      const spots = listOf(props.hotspots);
      if (!str(props.imageKey)) return null;
      return (
        <View style={box}>
          <View className="micro-hotspot">
            <Image className="micro-hotspot-image" src={imageSrc(str(props.imageKey))} mode="widthFix" />
            {spots.map((spot, index) => (
              <View
                key={index}
                className="micro-hotspot-area"
                style={{
                  left: `${num(spot.x)}%`,
                  top: `${num(spot.y)}%`,
                  width: `${num(spot.w)}%`,
                  height: `${num(spot.h)}%`,
                }}
                onClick={() => void openMicroLink((spot.link ?? null) as never)}
              />
            ))}
          </View>
        </View>
      );
    }
    case 'goods':
      return (
        <View style={box}>
          <GoodsBlock component={component} />
        </View>
      );
    case 'divider':
      return (
        <View style={box}>
          <View
            className="micro-divider-line"
            style={{
              marginTop: `${num(props.spacing, 12)}px`,
              marginBottom: `${num(props.spacing, 12)}px`,
              borderTopWidth: `${num(props.thickness, 1)}px`,
              borderTopStyle: (str(props.style, 'solid') as never) || 'solid',
              borderTopColor: str(props.color) || undefined,
            }}
          />
        </View>
      );
    case 'video': {
      if (!str(props.videoKey)) return null;
      const ratio = str(props.ratio, '16:9');
      return (
        <View style={box}>
          <Video
            className="micro-video"
            style={{ height: `${RATIO_HEIGHT[ratio] ?? 211}px` }}
            src={imageSrc(str(props.videoKey))}
            poster={imageSrc(str(props.coverKey))}
            autoplay={props.autoplay === true}
            loop={props.loop === true}
            muted={props.muted !== false}
            controls
            objectFit="cover"
          />
        </View>
      );
    }
    case 'text': {
      const content = str(props.content);
      if (!content) return null;
      return (
        <View
          style={{
            ...box,
            fontSize: `${num(props.fontSize, 14)}px`,
            color: str(props.color) || tokens.color.ink,
            fontWeight: props.weight === 'bold' ? 700 : 400,
            textAlign: (str(props.align, 'left') as never) || 'left',
            lineHeight: num(props.lineHeight, 1.5),
          }}
          onClick={() => void openMicroLink((props.link ?? null) as never)}
        >
          <Text className="micro-text" style={{ whiteSpace: 'pre-wrap' }}>
            {content}
          </Text>
        </View>
      );
    }
    case 'navGrid': {
      const items = listOf(props.items);
      if (!items.length) return null;
      const columns = num(props.columns, 4) === 5 ? 5 : 4;
      return (
        <View style={box}>
          <View className="micro-nav">
            {items.map((item, index) => (
              <View
                key={index}
                className="micro-nav-item"
                style={{ width: `${100 / columns}%` }}
                onClick={() => void openMicroLink((item.link ?? null) as never)}
              >
                {str(item.iconKey) ? (
                  <Image
                    className={`micro-nav-icon micro-nav-icon-${str(props.iconShape, 'circle')}`}
                    src={imageSrc(str(item.iconKey))}
                    mode="aspectFill"
                  />
                ) : (
                  <View className={`micro-nav-fallback micro-nav-icon-${str(props.iconShape, 'circle')}`}>
                    <Text>{str(item.name, '入').slice(0, 1)}</Text>
                  </View>
                )}
                <Text
                  className="micro-nav-name"
                  style={{ fontSize: `${num(props.fontSize, 12)}px`, color: str(props.textColor) || undefined }}
                >
                  {str(item.name)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      );
    }
    default:
      return null;
  }
}

export function MicroRenderer({ components }: { components: MicroComponent[] }) {
  return (
    <View className="micro-renderer">
      {components
        .filter((component) => component.visible !== false)
        .map((component) => (
          <MicroComponentView key={component.id} component={component} />
        ))}
    </View>
  );
}
