import { Image, Text, View } from '@tarojs/components';
import { useState } from 'react';

import { money } from '../utils/format';

export function Empty({ text = '这里还什么都没有' }: { text?: string }) {
  return <View className="empty">{text}</View>;
}

export function Loading({ text = '加载中…' }: { text?: string }) {
  return <View className="loading">{text}</View>;
}

export function Price({ cents, className = 'price' }: { cents: number; className?: string }) {
  return <Text className={className}>{money(cents)}</Text>;
}

/** 商品图：后端只存 key，真实环境由 CDN 前缀解析；加载失败退化为品牌色块 */
export function ProductThumb({
  imageKey,
  title,
  className = 'thumb',
}: {
  imageKey?: string | null;
  title: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!imageKey || failed) {
    return (
      <View className={`${className} thumb-fallback`}>{title.slice(0, 1)}</View>
    );
  }

  return (
    <Image
      className={className}
      src={imageKey.startsWith('http') ? imageKey : `/static/${imageKey}`}
      mode="aspectFill"
      onError={() => setFailed(true)}
    />
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <View className="section-title">{children}</View>;
}
