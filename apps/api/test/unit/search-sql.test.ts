import { describe, expect, it } from 'vitest';

import { buildOrderBy, escapeLike, keywordCondition } from '../../src/prisma/search';

/** Prisma.Sql 的 SQL 片段文本（不含参数值） */
function sqlText(query: { text: string }): string {
  return query.text;
}

describe('搜索 SQL 构造', () => {
  it('单字符关键词降级为 ILIKE，不再使用 trigram 运算符', () => {
    const query = sqlText(keywordCondition('茶'));
    expect(query).toContain('ILIKE');
    expect(query).not.toContain('<%');
    expect(query).not.toContain('"%');
  });

  it('多字符关键词同时使用 ILIKE 与 trigram 模糊匹配', () => {
    const query = sqlText(keywordCondition('普洱'));
    expect(query).toContain('ILIKE');
    expect(query).toContain('<%');
  });

  it('LIKE 通配符被转义', () => {
    expect(escapeLike('50%')).toBe('50\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('a\\b')).toBe('a\\\\b');
    expect(escapeLike('普洱')).toBe('普洱');
  });

  it('默认排序按相关度 + 销量 + 人工排序，并以 id 兜底', () => {
    const withKeyword = sqlText(buildOrderBy('default', '普洱'));
    expect(withKeyword).toContain('similarity');
    expect(withKeyword).toContain('"soldCount" DESC');
    expect(withKeyword).toContain('"sort" ASC');
    expect(withKeyword.trimEnd().endsWith('"id" ASC')).toBe(true);

    const withoutKeyword = sqlText(buildOrderBy('default', undefined));
    expect(withoutKeyword).not.toContain('similarity');
    expect(withoutKeyword).toContain('"sort" ASC');
  });

  it('销量 / 价格 / 新品排序均带稳定分页兜底', () => {
    expect(sqlText(buildOrderBy('sales', '普洱'))).toContain('"soldCount" DESC');
    expect(sqlText(buildOrderBy('sales', '普洱'))).toContain('similarity');
    expect(sqlText(buildOrderBy('price_asc', undefined))).toContain('"priceMinCents" ASC');
    expect(sqlText(buildOrderBy('price_desc', undefined))).toContain('"priceMinCents" DESC');
    expect(sqlText(buildOrderBy('new', undefined))).toContain('"createdAt" DESC');

    for (const sort of ['sales', 'price_asc', 'price_desc', 'new', 'default'] as const) {
      expect(sqlText(buildOrderBy(sort, '普洱')).trimEnd().endsWith('"id" ASC')).toBe(true);
    }
  });
});
