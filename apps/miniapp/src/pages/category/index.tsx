import { Image, Input, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useReachBottom, useRouter } from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';

import { api, showError } from '../../api/client';
import { AppTabBar } from '../../components/AppTabBar';
import { PageState, imageSrc } from '../../components/common';
import { ProductCard, type ProductCardData } from '../../components/ProductCard';

import './index.css';

interface Category {
  id: string;
  name: string;
  iconKey: string | null;
  productCount: number;
  children: { id: string; name: string; iconKey: string | null }[];
}

interface ProductItem extends ProductCardData {
  status: string;
}

interface ProductPage {
  total: number;
  page: number;
  pageSize: number;
  items: ProductItem[];
}

type SortKey = 'default' | 'sales' | 'price_asc' | 'price_desc';

export default function Page() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeRootId, setActiveRootId] = useState('');
  const [activeChildId, setActiveChildId] = useState('');
  const [sort, setSort] = useState<SortKey>('default');
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<ProductItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    void (async () => {
      try {
        const list = await api<Category[]>('/categories', { auth: 'optional' });
        setCategories(list);
        const wanted = router.params.categoryId ?? '';
        const root = list.find((item) => item.id === wanted);
        if (root) {
          setActiveRootId(root.id);
          return;
        }
        const parent = list.find((item) => item.children.some((child) => child.id === wanted));
        if (parent) {
          setActiveRootId(parent.id);
          setActiveChildId(wanted);
          return;
        }
        setActiveRootId(list[0]?.id ?? '');
      } catch (err) {
        showError(err);
      }
    })();
    // 分类只在进入页面时拉取一次
  }, []);

  const activeRoot = categories.find((item) => item.id === activeRootId);
  const children = activeRoot?.children ?? [];
  const activeCategoryId = activeChildId || activeRootId;

  useEffect(() => {
    if (!activeCategoryId) return;
    void load(1, false);
  }, [activeCategoryId, sort]);

  const load = async (pageNo: number, append: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const res = await api<ProductPage>('/products', {
        query: { categoryId: activeCategoryId, sort, page: pageNo, pageSize: 20 },
        auth: 'optional',
      });
      setTotal(res.total);
      setPage(res.page);
      setItems((prev) => (append ? [...prev, ...res.items] : res.items));
    } catch (err) {
      showError(err);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  useReachBottom(() => {
    if (busy.current || items.length === 0 || items.length >= total) return;
    void load(page + 1, true);
  });

  function selectRoot(id: string) {
    if (id === activeRootId) return;
    setActiveRootId(id);
    setActiveChildId('');
    setSort('default');
  }

  function goSearch() {
    const value = keyword.trim();
    void Taro.navigateTo({
      url: value
        ? `/pages/search/index?keyword=${encodeURIComponent(value)}`
        : '/pages/search/index',
    });
  }

  function togglePrice() {
    setSort((prev) => (prev === 'price_asc' ? 'price_desc' : 'price_asc'));
  }

  return (
    <View className="cat-page">
      <View className="cat-top">
        <View className="cat-search">
          <Text className="cat-search-icon">⌕</Text>
          <Input
            className="cat-search-input"
            value={keyword}
            placeholder="请输入关键词"
            confirmType="search"
            onInput={(event) => setKeyword(event.detail.value)}
            onConfirm={goSearch}
          />
          <View className="cat-search-btn" onClick={goSearch}>
            <Text>搜索</Text>
          </View>
        </View>

        <ScrollView className="cat-strip" scrollX enhanced showScrollbar={false}>
          <View className="cat-strip-inner">
            {categories.map((cat) => (
              <View
                key={cat.id}
                className={`cat-chip${cat.id === activeRootId ? ' cat-chip--on' : ''}`}
                onClick={() => selectRoot(cat.id)}
              >
                <View className="cat-chip-icon">
                  {cat.iconKey ? (
                    <Image className="cat-chip-image" src={imageSrc(cat.iconKey)} mode="aspectFill" />
                  ) : (
                    <Text className="cat-chip-letter">{cat.name.slice(0, 1)}</Text>
                  )}
                </View>
                <Text className="cat-chip-name">{cat.name}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      <View className="cat-body">
        {children.length > 0 && (
          <View className="cat-side">
            <View
              className={`cat-side-item${activeChildId === '' ? ' cat-side-item--on' : ''}`}
              onClick={() => setActiveChildId('')}
            >
              <Text className="ellipsis">全部</Text>
            </View>
            {children.map((child) => (
              <View
                key={child.id}
                className={`cat-side-item${child.id === activeChildId ? ' cat-side-item--on' : ''}`}
                onClick={() => setActiveChildId(child.id)}
              >
                <Text className="ellipsis">{child.name}</Text>
              </View>
            ))}
          </View>
        )}

        <View className="cat-main">
          <View className="cat-sort">
            <View
              className={`cat-sort-item${sort === 'default' ? ' cat-sort-item--on' : ''}`}
              onClick={() => setSort('default')}
            >
              <Text>综合</Text>
            </View>
            <View
              className={`cat-sort-item${sort === 'sales' ? ' cat-sort-item--on' : ''}`}
              onClick={() => setSort('sales')}
            >
              <Text>销量</Text>
            </View>
            <View
              className={`cat-sort-item${
                sort === 'price_asc' || sort === 'price_desc' ? ' cat-sort-item--on' : ''
              }`}
              onClick={togglePrice}
            >
              <Text>价格</Text>
              <Text className="cat-sort-arrow">
                {sort === 'price_desc' ? '↓' : sort === 'price_asc' ? '↑' : '↑↓'}
              </Text>
            </View>
            <Text className="cat-count">{total} 件</Text>
          </View>

          <PageState
            loading={loading && !items.length}
            empty={!loading && !items.length}
            text="该分类下暂无商品"
          />

          {items.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}

          {!!items.length && (
            <View className="cat-more muted tiny">
              {loading ? '加载中…' : items.length >= total ? '没有更多了' : '上拉加载更多'}
            </View>
          )}
        </View>
      </View>

      <AppTabBar />
    </View>
  );
}
