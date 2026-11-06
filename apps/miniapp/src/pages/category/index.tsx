import { Text, View } from '@tarojs/components';
import Taro, { useReachBottom, useRouter } from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';

import { api, showError } from '../../api/client';
import { Empty, Loading } from '../../components/common';
import { ProductCard, type ProductCardData } from '../../components/ProductCard';

import './index.css';

interface Category {
  id: string;
  name: string;
  productCount: number;
  children: { id: string; name: string }[];
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

const SORTS = [
  { key: 'default', label: '默认' },
  { key: 'sales', label: '销量' },
  { key: 'price_asc', label: '价格升' },
  { key: 'price_desc', label: '价格降' },
];

export default function Page() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeId, setActiveId] = useState('');
  const [sort, setSort] = useState('default');
  const [items, setItems] = useState<ProductItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    void (async () => {
      try {
        const list = await api<Category[]>('/categories');
        setCategories(list);
        const wanted = router.params.categoryId ?? '';
        const exists = list.some((c) => c.id === wanted);
        setActiveId(wanted && exists ? wanted : (list[0]?.id ?? ''));
      } catch (err) {
        showError(err);
      }
    })();
    // 分类只在进入页面时拉取一次
  }, []);

  useEffect(() => {
    if (!activeId) return;
    void load(1, false);
  }, [activeId, sort]);

  const load = async (pageNo: number, append: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const res = await api<ProductPage>('/products', {
        query: { categoryId: activeId, sort, page: pageNo, pageSize: 20 },
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

  const activeCategory = categories.find((c) => c.id === activeId);

  return (
    <View className="cat-page">
      <View className="cat-side">
        {categories.map((cat) => (
          <View
            key={cat.id}
            className={`cat-side-item${cat.id === activeId ? ' cat-side-item--on' : ''}`}
            onClick={() => {
              setSort('default');
              setActiveId(cat.id);
            }}
          >
            <Text className="ellipsis">{cat.name}</Text>
          </View>
        ))}
      </View>

      <View className="cat-main">
        <View className="cat-head">
          <Text className="title">{activeCategory?.name ?? '全部商品'}</Text>
          <Text className="muted tiny">{total} 件</Text>
        </View>

        <View className="tabs">
          {SORTS.map((item) => (
            <View
              key={item.key}
              className={`tab${sort === item.key ? ' tab--on' : ''}`}
              onClick={() => setSort(item.key)}
            >
              {item.label}
            </View>
          ))}
        </View>

        {loading && !items.length && <Loading />}
        {!loading && !items.length && <Empty text="该分类下暂无商品" />}

        {items.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}

        {!!items.length && (
          <View className="cat-more muted tiny">
            {loading ? '加载中…' : items.length >= total ? '没有更多了' : '上拉加载更多'}
          </View>
        )}

        {!!activeCategory?.children.length && (
          <View className="cat-children">
            {activeCategory.children.map((child) => (
              <View
                key={child.id}
                className="tag"
                onClick={() => Taro.navigateTo({ url: `/pages/category/index?categoryId=${child.id}` })}
              >
                {child.name}
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
