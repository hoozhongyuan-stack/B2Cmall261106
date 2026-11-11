import { Image, Input, Text, View } from '@tarojs/components';
import { useState, type ReactNode } from 'react';

import { money } from '../utils/format';

export function Empty({
  text = '这里还什么都没有',
  compact = false,
}: {
  text?: string;
  compact?: boolean;
}) {
  return <View className={compact ? 'empty empty--compact' : 'empty'}>{text}</View>;
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

/** 页面三态：加载中 / 空 / 内容，统一所有页面的占位表现 */
export function PageState({
  loading,
  empty,
  text,
  children,
}: {
  loading?: boolean;
  empty?: boolean;
  text?: string;
  children?: ReactNode;
}) {
  if (loading) return <Loading />;
  if (empty) return <Empty text={text} />;
  return <>{children}</>;
}

/** 列表行：标题 + 右侧值 + 箭头，替代各页手写的菜单行 */
export function Cell({
  title,
  value,
  icon,
  arrow = true,
  onClick,
}: {
  title: string;
  value?: ReactNode;
  icon?: ReactNode;
  arrow?: boolean;
  onClick?: () => void;
}) {
  return (
    <View className="cell" onClick={onClick}>
      {icon && <Text className="cell-icon">{icon}</Text>}
      <Text className="cell-title">{title}</Text>
      {value !== undefined && value !== '' && <Text className="cell-value">{value}</Text>}
      {arrow && <Text className="cell-arrow">›</Text>}
    </View>
  );
}

/** 区块标题 + 右侧操作，统一「我的订单 · 全部订单」这类结构 */
export function SectionHeader({
  title,
  action,
  onAction,
  className = '',
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <View className={`section-head ${className}`}>
      <Text className="section-title">{title}</Text>
      {action && (
        <Text
          className={`section-action${onAction ? ' section-action--brand' : ''}`}
          onClick={onAction}
        >
          {action}
        </Text>
      )}
    </View>
  );
}

/** 统计块：个人中心、门店中心、看板共用 */
export function StatTile({
  label,
  value,
  hint,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  onClick?: () => void;
}) {
  return (
    <View className="stat-tile" onClick={onClick}>
      <Text className="stat-tile-value">{value}</Text>
      <Text className="stat-tile-label">{label}</Text>
      {hint && <Text className="stat-tile-hint">{hint}</Text>}
    </View>
  );
}

/** 搜索条：分类、门店、搜索页共用 */
export function SearchBar({
  value,
  placeholder,
  action = '搜索',
  onInput,
  onSubmit,
}: {
  value: string;
  placeholder?: string;
  action?: string;
  onInput: (value: string) => void;
  onSubmit?: () => void;
}) {
  return (
    <View className="search-bar">
      <Input
        className="search-bar-input"
        value={value}
        placeholder={placeholder}
        onInput={(event) => onInput(event.detail.value)}
        onConfirm={onSubmit}
      />
      <Text className="search-bar-btn" onClick={onSubmit}>
        {action}
      </Text>
    </View>
  );
}

/** 轻量标签，统一订单/门店/优惠券状态样式 */
export function Tag({
  children,
  tone = 'muted',
}: {
  children: string;
  tone?: 'muted' | 'brand' | 'gold';
}) {
  return <Text className={tone === 'muted' ? 'tag' : `tag tag--${tone}`}>{children}</Text>;
}
