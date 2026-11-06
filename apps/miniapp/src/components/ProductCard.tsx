import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';

import { money } from '../utils/format';
import { ProductThumb } from './common';

export interface ProductCardData {
  id: string;
  title: string;
  subtitle?: string | null;
  mainImageKey?: string | null;
  priceMinCents: number;
  priceMaxCents?: number;
  soldCount?: number;
}

/** 商品行卡片：图 + 标题 + 副标题 + 到手价 + 销量 */
export function ProductCard({ product }: { product: ProductCardData }) {
  const range =
    product.priceMaxCents && product.priceMaxCents > product.priceMinCents
      ? `${money(product.priceMinCents)} 起`
      : money(product.priceMinCents);

  return (
    <View
      className="card"
      style={{ display: 'flex', gap: '24px', alignItems: 'center', marginBottom: '20px' }}
      onClick={() => Taro.navigateTo({ url: `/pages/product/index?id=${product.id}` })}
    >
      <ProductThumb imageKey={product.mainImageKey} title={product.title} />
      <View className="grow" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <Text className="title title--sm">{product.title}</Text>
        {product.subtitle && <Text className="muted small ellipsis">{product.subtitle}</Text>}
        <View className="row-between" style={{ marginTop: '8px' }}>
          <Text className="price">{range}</Text>
          {typeof product.soldCount === 'number' && (
            <Text className="muted tiny">已售 {product.soldCount}</Text>
          )}
        </View>
      </View>
    </View>
  );
}
