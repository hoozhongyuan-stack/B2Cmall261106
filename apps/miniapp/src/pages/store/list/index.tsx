import { Image, Input, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useState } from 'react';

import { api, showError } from '../../../api/client';
import { Empty, Loading, imageSrc } from '../../../components/common';
import { money } from '../../../utils/format';

import './index.css';

const PICKUP_STORE_KEY = 'checkout_store_id';
const DELIVERY_STORE_KEY = 'checkout_delivery_store_id';

interface Store {
  id: string;
  name: string;
  phone: string | null;
  logoKey: string | null;
  region: string;
  address: string;
  businessHours: Record<string, string[][]>;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryFeeCents: number;
  freeDeliveryThresholdCents: number;
  deliverySlots: string[];
  deliveryCutoff: string | null;
  deliveryRegions: string[];
  notice: string | null;
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function todayHours(store: Store): string {
  const ranges = store.businessHours[WEEKDAYS[new Date().getDay()]];
  if (!ranges?.length) return '营业时间请咨询门店';
  return ranges.map(([open, close]) => `${open}-${close}`).join('、');
}

function normalize(value: string): string {
  return value.replace(/\s+/g, '');
}

/** 配送门店按区县白名单匹配；自提门店按门店所在区域匹配 */
function matchRegion(store: Store, keyword: string, capability: 'PICKUP' | 'DELIVERY'): boolean {
  const k = normalize(keyword);
  if (!k) return true;
  if (normalize(store.region).includes(k)) return true;
  if (capability === 'PICKUP') return false;
  return store.deliveryRegions.some((region) =>
    region
      .split('/')
      .map(normalize)
      .filter(Boolean)
      .some((part) => k.includes(part) || part.includes(k)),
  );
}

export default function Page() {
  const router = useRouter();
  const capability: 'PICKUP' | 'DELIVERY' =
    router.params.capability === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';
  const [items, setItems] = useState<Store[]>([]);
  const [region, setRegion] = useState(
    router.params.region ? decodeURIComponent(router.params.region) : '',
  );
  const [loading, setLoading] = useState(true);

  const load = async (keyword = '') => {
    setLoading(true);
    try {
      const result = await api<{ items: Store[] }>('/stores', {
        query: { capability },
        auth: 'optional',
      });
      setItems(result.items.filter((store) => matchRegion(store, keyword, capability)));
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => {
    void load(region);
  });

  const choose = (store: Store) => {
    Taro.setStorageSync(
      capability === 'DELIVERY' ? DELIVERY_STORE_KEY : PICKUP_STORE_KEY,
      store.id,
    );
    void Taro.navigateBack();
  };

  return (
    <View className="page store-page">
      <View className="store-search">
        <Input
          className="store-search-input"
          value={region}
          placeholder={capability === 'DELIVERY' ? '输入区县筛选配送门店' : '输入区县，如 五华区'}
          onInput={(e) => setRegion(e.detail.value)}
          onConfirm={() => void load(region)}
        />
        <Text className="store-search-btn" onClick={() => void load(region)}>
          搜索
        </Text>
      </View>

      {loading && !items.length && <Loading />}
      {!loading && !items.length && (
        <Empty text={capability === 'DELIVERY' ? '当前区域暂无可配送门店' : '暂无可自提门店'} />
      )}

      {items.map((store) => (
        <View key={store.id} className="card store-card" onClick={() => choose(store)}>
          <View className="row-between">
            <View className="row" style={{ gap: '12px', alignItems: 'center' }}>
              {store.logoKey ? (
                <Image className="store-logo" src={imageSrc(store.logoKey)} mode="aspectFill" />
              ) : (
                <View className="store-logo store-logo--empty">
                  <Text>{store.name.slice(0, 1)}</Text>
                </View>
              )}
              <Text className="store-name">{store.name}</Text>
            </View>
            <Text className="tag tag--brand">
              {capability === 'DELIVERY' ? '可配送' : '可自提'}
            </Text>
          </View>
          <Text className="small muted store-address">
            {store.region} {store.address}
          </Text>
          <View className="row-between store-meta">
            <Text className="tiny muted">今日营业 {todayHours(store)}</Text>
            {store.phone && <Text className="tiny muted">{store.phone}</Text>}
          </View>
          {capability === 'DELIVERY' && (
            <Text className="tiny muted store-notice">
              {store.deliveryFeeCents > 0 ? `配送费 ${money(store.deliveryFeeCents)}` : '免配送费'}
              {store.freeDeliveryThresholdCents > 0
                ? ` · 满 ${money(store.freeDeliveryThresholdCents)} 免配送费`
                : ''}
              {store.deliverySlots?.length ? ` · 时段 ${store.deliverySlots.join('、')}` : ''}
              {store.deliveryCutoff ? ` · ${store.deliveryCutoff} 截单` : ''}
            </Text>
          )}
          {store.notice && <Text className="tiny muted store-notice">{store.notice}</Text>}
        </View>
      ))}
    </View>
  );
}
