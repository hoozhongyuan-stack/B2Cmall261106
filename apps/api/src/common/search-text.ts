import { pinyin } from 'pinyin-pro';

export interface ProductSearchInput {
  title: string;
  subtitle?: string | null;
  categoryName?: string | null;
  tags?: string[];
}

/**
 * 商品搜索文本：标题 + 副标题 + 分类 + 标签 + 全拼/首字母。
 * 统一小写，供 trigram 检索；拼音只在服务端生成。
 */
export function buildProductSearchText(input: ProductSearchInput): string {
  const base = [input.title, input.subtitle, input.categoryName, ...(input.tags ?? [])]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.trim())
    .join(' ');
  if (!base) return '';

  // 全拼去掉音节分隔，便于用户连续输入「menghai」也能命中
  const full = pinyin(base, { toneType: 'none', type: 'array' }).join('');
  const initials = pinyin(base, {
    pattern: 'first',
    toneType: 'none',
    type: 'array',
  }).join('');

  return [base, full, initials]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
