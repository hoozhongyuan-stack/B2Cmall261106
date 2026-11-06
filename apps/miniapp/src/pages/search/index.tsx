import { Input, Text, View } from '@tarojs/components';
import Taro, { useReachBottom } from '@tarojs/taro';
import { useRef, useState } from 'react';

import { api, showError } from '../../api/client';
import { Empty, Loading } from '../../components/common';
import { ProductCard, type ProductCardData } from '../../components/ProductCard';
import { useRequest } from '../../hooks/useRequest';

import './index.css';

const HISTORY_KEY = 'search_history';
const HISTORY_MAX = 10;

interface ProductItem extends ProductCardData {
  status: string;
}

interface ProductPage {
  total: number;
  page: number;
  items: ProductItem[];
}

interface HomeData {
  picks: {
    id: string;
    title: string;
    subtitle: string | null;
    mainImageKey: string | null;
    priceCents: number;
  }[];
}

function readHistory(): string[] {
  const list = Taro.getStorageSync<string[]>(HISTORY_KEY);
  return Array.isArray(list) ? list : [];
}

export default function Page() {
  const [keyword, setKeyword] = useState('');
  const [history, setHistory] = useState<string[]>(readHistory);
  const [items, setItems] = useState<ProductItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState('');
  const busy = useRef(false);
  const { data: home } = useRequest(() => api<HomeData>('/home'));

  const remember = (word: string) => {
    const next = [word, ...readHistory().filter((item) => item !== word)].slice(0, HISTORY_MAX);
    Taro.setStorageSync(HISTORY_KEY, next);
    setHistory(next);
  };

  const load = async (word: string, pageNo: number) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const res = await api<ProductPage>('/products', {
        query: { keyword: word, page: pageNo, pageSize: 20 },
      });
      setTotal(res.total);
      setPage(pageNo);
      setItems((prev) => (pageNo === 1 || !prev ? res.items : [...prev, ...res.items]));
    } catch (err) {
      showError(err);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  const submit = (word: string) => {
    const text = word.trim();
    if (!text) return;
    setKeyword(text);
    setSearched(text);
    remember(text);
    void load(text, 1);
  };

  useReachBottom(() => {
    if (!searched || busy.current || !items || items.length >= total) return;
    void load(searched, page + 1);
  });

  const clearHistory = () => {
    Taro.removeStorageSync(HISTORY_KEY);
    setHistory([]);
  };

  return (
    <View className="page">
      <View className="search-bar">
        <Input
          className="input grow"
          value={keyword}
          placeholder="搜索商品名称"
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

          <View className="section-title">大家都在买</View>
          {home?.picks.map((pick) => (
            <ProductCard
              key={pick.id}
              product={{
                id: pick.id,
                title: pick.title,
                subtitle: pick.subtitle,
                mainImageKey: pick.mainImageKey,
                priceMinCents: pick.priceCents,
              }}
            />
          ))}
        </>
      )}

      {!!searched && (
        <>
          <View className="row-between search-result-head">
            <Text className="small muted">
              「{searched}」共 {total} 件
            </Text>
            <Text className="muted tiny" onClick={() => setSearched('')}>
              取消搜索
            </Text>
          </View>

          {loading && !items?.length && <Loading />}
          {!loading && !items?.length && <Empty text="没有找到相关商品，换个词试试" />}
          {items?.map((product) => <ProductCard key={product.id} product={product} />)}
          {!!items?.length && (
            <View className="search-more muted tiny">
              {loading ? '加载中…' : items.length >= total ? '没有更多了' : '上拉加载更多'}
            </View>
          )}
        </>
      )}
    </View>
  );
}
