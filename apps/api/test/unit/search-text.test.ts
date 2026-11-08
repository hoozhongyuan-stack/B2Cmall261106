import { describe, expect, it } from 'vitest';

import { buildProductSearchText } from '../../src/common/search-text';

describe('商品搜索文本', () => {
  it('包含标题、分类、标签与全拼/首字母', () => {
    const text = buildProductSearchText({
      title: '勐海古树普洱',
      subtitle: '2019 春茶',
      categoryName: '普洱茶',
      tags: ['古树', '生茶'],
    });

    expect(text).toContain('勐海古树普洱');
    expect(text).toContain('普洱茶');
    expect(text).toContain('古树');
    expect(text).toContain('menghaigushupuer');
    expect(text).toContain('mhgspe');
  });

  it('英文与数字保留原样并转小写', () => {
    const text = buildProductSearchText({ title: 'Coffee Bean 500g' });
    expect(text).toContain('coffee bean 500g');
  });

  it('空字段不会产生多余空格', () => {
    const text = buildProductSearchText({ title: '  咖啡  ', subtitle: null, tags: [] });
    expect(text).toBe(text.trim());
    expect(text.startsWith('咖啡')).toBe(true);
    expect(text).not.toContain('  ');
  });
});
