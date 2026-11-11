import { Input, Text, View } from '@tarojs/components';
import Taro, { useReachBottom, useRouter } from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';

import { api, showError } from '../../api/client';
import { PageState } from '../../components/common';
import { ProductCard, type ProductCardData } from '../../components/ProductCard';
import { useRequest } from '../../hooks/useRequest';

import './index.css';

const HISTORY_KEY = 'search_history';
const HISTORY_MAX = 10;

type SortKey = 'default' | 'sales' | 'price_asc' | 'price_desc' | 'new';

interface ProductItem extends ProductCardData {
  status: string;
}

interface ProductPage {
  total: number;
  page: number;
  items: ProductItem[];
}

interface Category {
  id: string;
  name: string;
  children: { id: string; name: string }[];
}

interface Tag {
  id: string;
  name: string;
}

interface PriceRange {
  key: string;
  label: string;
  min?: number;
  max?: number;
}

const PRICE_RANGES: PriceRange[] = [
  { key: '', label: '不限' },
  { key: 'lt50', label: '50 元以下', min: 0, max: 5000 },
  { key: '50to100', label: '50-100 元', min: 5000, max: 10000 },
  { key: '100to200', label: '100-200 元', min: 10000, max: 20000 },
  { key: 'gt200', label: '200 元以上', min: 20000 },
];

function readHistory(): string[] {
  const list = Taro.getStorageSync<string[]>(HISTORY_KEY);
  return Array.isArray(list) ? list : [];
}

export default function Page() {
  const router = useRouter();
  const [keyword, setKeyword] = useState('');
  const [history, setHistory] = useState<string[]>(readHistory);
  const [hot, setHot] = useState<string[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [items, setItems] = useState<ProductItem[] | null>(null);
  const [recommend, setRecommend] = useState<ProductItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState('');
  const [sort, setSort] = useState<SortKey>('default');
  const [categoryId, setCategoryId] = useState('');
  const [tagId, setTagId] = useState('');
  const [priceKey, setPriceKey] = useState('');
  const seq = useRef(0);
  const { data: suggest } = useRequest(() =>
    api<ProductPage>('/products', {
      query: { sort: 'default', page: 1, pageSize: 6 },
      auth: 'optional',
    }),
  );

  // 筛选栏数据：分类、标签与聚合热词
  useEffect(() => {
    void (async () => {
      try {
        const [cats, tagList, hotList] = await Promise.all([
          api<Category[]>('/categories', { auth: 'optional' }),
          api<Tag[]>('/tags', { auth: 'optional' }),
          api<string[]>('/search/hot', { auth: 'optional' }),
        ]);
        setCategories(cats);
        setTags(tagList);
        setHot(hotList);
      } catch (err) {
        showError(err);
      }
    })();
  }, []);

  const remember = (word: string) => {
    const next = [word, ...readHistory().filter((item) => item !== word)].slice(0, HISTORY_MAX);
    Taro.setStorageSync(HISTORY_KEY, next);
    setHistory(next);
  };

  const load = async (word: string, pageNo: number, append: boolean) => {
    const current = ++seq.current;
    const range = PRICE_RANGES.find((item) => item.key === priceKey);
    setLoading(true);
    try {
      const res = await api<ProductPage>('/products', {
        query: {
          keyword: word,
          page: pageNo,
          pageSize: 20,
          sort,
          categoryId: categoryId || undefined,
          tagId: tagId || undefined,
          priceMinCents: range?.min,
          priceMaxCents: range?.max,
        },
        auth: 'optional',
      });
      if (current !== seq.current) return;
      setTotal(res.total);
      setPage(pageNo);
      setItems((prev) => (append && prev ? [...prev, ...res.items] : res.items));
    } catch (err) {
      if (current === seq.current) showError(err);
    } finally {
      if (current === seq.current) setLoading(false);
    }
  };

  const submit = (word: string) => {
    const text = word.trim();
    if (!text) return;
    setKeyword(text);
    setSearched(text);
    remember(text);
  };

  // 关键词、排序与筛选变化时重新从第一页拉取
  useEffect(() => {
    if (!searched) return;
    void load(searched, 1, false);
  }, [searched, sort, categoryId, tagId, priceKey]);

  // 无结果时推荐同分类热销（未选分类则推荐全店热销）
  useEffect(() => {
    if (!searched || loading || total > 0) {
      setRecommend([]);
      return;
    }
    void (async () => {
      try {
        const res = await api<ProductPage>('/products', {
          query: {
            page: 1,
            pageSize: 4,
            sort: 'sales',
            categoryId: categoryId || undefined,
          },
          auth: 'optional',
        });
        setRecommend(res.items);
      } catch {
        // 推荐失败不影响空状态展示
      }
    })();
  }, [searched, loading, total, categoryId]);

  // 从首页运营位带关键词进入时直接搜索
  useEffect(() => {
    const initial = router.params.keyword;
    if (initial) submit(decodeURIComponent(initial));
  }, []);

  useReachBottom(() => {
    if (!searched || loading || !items || items.length >= total) return;
    void load(searched, page + 1, true);
  });

  const clearHistory = () => {
    Taro.removeStorageSync(HISTORY_KEY);
    setHistory([]);
  };

  const resetSearch = () => {
    seq.current += 1;
    setSearched('');
    setItems(null);
    setTotal(0);
    setPage(0);
    setSort('default');
    setCategoryId('');
    setTagId('');
    setPriceKey('');
  };

  const togglePriceSort = () => {
    setSort(sort === 'price_asc' ? 'price_desc' : 'price_asc');
  };

  const sortTabs: { key: SortKey; label: string; on: boolean }[] = [
    { key: 'default', label: '综合', on: sort === 'default' },
    { key: 'sales', label: '销量', on: sort === 'sales' },
    {
      key: 'price_asc',
      label: sort === 'price_asc' ? '价格 ↑' : sort === 'price_desc' ? '价格 ↓' : '价格',
      on: sort === 'price_asc' || sort === 'price_desc',
    },
    { key: 'new', label: '新品', on: sort === 'new' },
  ];

  const categoryOptions = categories.flatMap((cat) => [
    { id: cat.id, name: cat.name },
    ...cat.children.map((child) => ({ id: child.id, name: child.name })),
  ]);

  return (
    <View className="page">
      <View className="search-bar">
        <Input
          className="input grow"
          value={keyword}
          placeholder="搜索商品名称 / 拼音"
          confirmType="search"
          onInput={(e) => setKeyword(e.detail.value)}
          onConfirm={(e) => submit(e.detail.value)}
        />
        <View className="btn btn--primary search-btn" onClick={() => submit(keyword)}>
          搜索
        </View>
      </View>

      {!searched && (
        <>
          {!!history.length && (
            <>
              <View className="row-between section-title">
                <Text>搜索历史</Text>
                <Text className="muted tiny" onClick={clearHistory}>
                  清空
                </Text>
              </View>
              <View className="search-tags">
                {history.map((word) => (
                  <View key={word} className="tag" onClick={() => submit(word)}>
                    {word}
                  </View>
                ))}
              </View>
            </>
          )}

          {!!hot.length && (
            <>
              <View className="section-title">热门搜索</View>
              <View className="search-tags">
                {hot.map((word) => (
                  <View key={word} className="tag tag--brand" onClick={() => submit(word)}>
                    {word}
                  </View>
                ))}
              </View>
            </>
          )}

          <View className="section-title">大家都在买</View>
          {suggest?.items.map((pick) => (
            <ProductCard
              key={pick.id}
              product={{
                id: pick.id,
                title: pick.title,
                subtitle: pick.subtitle,
                mainImageKey: pick.mainImageKey,
                priceMinCents: pick.priceMinCents,
              }}
            />
          ))}
        </>
      )}

      {!!searched && (
        <>
          <View className="tabs search-sorts">
            {sortTabs.map((item) => (
              <View
                key={item.key}
                className={`tab${item.on ? ' tab--on' : ''}`}
                onClick={() => (item.key === 'price_asc' ? togglePriceSort() : setSort(item.key))}
              >
                {item.label}
              </View>
            ))}
          </View>

          <View className="filter-bar">
            <View className="filter-row">
              <Text className="filter-label">分类</Text>
              <View className="filter-options">
                <View
                  className={`tag${!categoryId ? ' tag--brand' : ''}`}
                  onClick={() => setCategoryId('')}
                >
                  全部
                </View>
                {categoryOptions.map((item) => (
                  <View
                    key={item.id}
                    className={`tag${categoryId === item.id ? ' tag--brand' : ''}`}
                    onClick={() => setCategoryId(item.id)}
                  >
                    {item.name}
                  </View>
                ))}
              </View>
            </View>

            <View className="filter-row">
              <Text className="filter-label">价格</Text>
              <View className="filter-options">
                {PRICE_RANGES.map((item) => (
                  <View
                    key={item.key || 'all'}
                    className={`tag${priceKey === item.key ? ' tag--brand' : ''}`}
                    onClick={() => setPriceKey(item.key)}
                  >
                    {item.label}
                  </View>
                ))}
              </View>
            </View>

            {!!tags.length && (
              <View className="filter-row">
                <Text className="filter-label">标签</Text>
                <View className="filter-options">
                  <View
                    className={`tag${!tagId ? ' tag--brand' : ''}`}
                    onClick={() => setTagId('')}
                  >
                    全部
                  </View>
                  {tags.map((item) => (
                    <View
                      key={item.id}
                      className={`tag${tagId === item.id ? ' tag--brand' : ''}`}
                      onClick={() => setTagId(item.id)}
                    >
                      {item.name}
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>

          <View className="row-between search-result-head">
            <Text className="small muted">
              「{searched}」共 {total} 件
            </Text>
            <Text className="muted tiny" onClick={resetSearch}>
              取消搜索
            </Text>
          </View>

          <PageState
            loading={loading && !items?.length}
            empty={!loading && !items?.length}
            text="没有找到相关商品，换个词或筛选条件试试"
          />
          {items?.map((product) => <ProductCard key={product.id} product={product} />)}
          {!!items?.length && (
            <View className="search-more muted tiny">
              {loading ? '加载中…' : items.length >= total ? '没有更多了' : '上拉加载更多'}
            </View>
          )}

          {!loading && total === 0 && !!recommend.length && (
            <>
              <View className="section-title">
                {categoryId ? '同分类热销推荐' : '热销推荐'}
              </View>
              {recommend.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </>
          )}
        </>
      )}
    </View>
  );
}
