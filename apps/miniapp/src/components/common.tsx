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

/**
 * 图片地址解析：
 * - http(s) 外链原样使用
 * - / 开头为服务端素材（/api/media/assets/...），按 API 域名拼接
 * - 其余为历史静态素材，走小程序包内 /static/
 */
export function imageSrc(key: string): string {
  if (/^https?:\/\//i.test(key)) return key;
  if (key.startsWith('/')) {
    return `${API_BASE.replace(/\/api\/?$/, '')}${key}`;
  }
  return `/static/${key}`;
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
      src={imageSrc(imageKey)}
      mode="aspectFill"
      onError={() => setFailed(true)}
    />
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <View className="section-title">{children}</View>;
}
