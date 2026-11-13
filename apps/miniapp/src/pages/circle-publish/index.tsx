import { Image, Input, Text, Textarea, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useMemo, useState } from 'react';

import { api, ensureLogin, getToken, showError } from '../../api/client';
import { Empty, imageSrc, Loading } from '../../components/common';
import { money } from '../../utils/format';

import './index.css';

const MAX_IMAGES = 9;
const MAX_CONTENT = 1000;
const MAX_TOPICS = 3;
const MAX_PRODUCTS = 3;

interface Category {
  id: string;
  name: string;
  iconKey: string | null;
}

interface Topic {
  id: string;
  name: string;
  categoryId: string | null;
  pinned: boolean;
  postCount: number;
}

interface ProductHit {
  id: string;
  title: string;
  mainImageKey: string | null;
  priceMinCents: number;
}

export default function Page() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);

  const [content, setContent] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductHit[]>([]);
  const [keyword, setKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [categoryResult, topicResult] = await Promise.all([
          api<{ enabled: boolean; items: Category[] }>('/circle/categories'),
          api<{ items: Topic[] }>('/circle/topics'),
        ]);
        setEnabled(categoryResult.enabled);
        setCategories(categoryResult.items);
        setTopics(topicResult.items);
        if (categoryResult.items[0]) setCategoryId(categoryResult.items[0].id);
      } catch (err) {
        showError(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /** 话题需与所选类目一致（或话题不限类目） */
  const visibleTopics = useMemo(
    () => topics.filter((topic) => !topic.categoryId || topic.categoryId === categoryId),
    [topics, categoryId],
  );

  const pickImages = async () => {
    if (images.length >= MAX_IMAGES) return;
    try {
      const result = await Taro.chooseImage({
        count: MAX_IMAGES - images.length,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      });
      setImages((prev) => [...prev, ...result.tempFilePaths].slice(0, MAX_IMAGES));
    } catch {
      /* 用户取消选择 */
    }
  };

  const uploadImages = async (paths: string[]): Promise<string[]> => {
    await ensureLogin();
    const token = getToken();
    const keys: string[] = [];
    for (const filePath of paths) {
      const res = await Taro.uploadFile({
        url: `${API_BASE}/circle/images`,
        filePath,
        name: 'files',
        header: token ? { authorization: `Bearer ${token}` } : {},
      });
      const body = JSON.parse(res.data) as {
        data?: { items: { key: string }[] };
        message?: string;
      };
      if (res.statusCode < 200 || res.statusCode >= 300 || !body.data) {
        throw new Error(body.message || '图片上传失败');
      }
      keys.push(...body.data.items.map((item) => item.key));
    }
    return keys;
  };

  const searchProducts = async () => {
    const value = keyword.trim();
    if (!value) return;
    setSearching(true);
    try {
      const result = await api<{ items: ProductHit[] }>('/products', {
        query: { keyword: value, pageSize: 10 },
        auth: 'optional',
      });
      setHits(result.items);
    } catch (err) {
      showError(err);
    } finally {
      setSearching(false);
    }
  };

  const toggleTopic = (id: string) => {
    setTopicIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      if (prev.length >= MAX_TOPICS) {
        void Taro.showToast({ title: `最多选择 ${MAX_TOPICS} 个话题`, icon: 'none' });
        return prev;
      }
      return [...prev, id];
    });
  };

  const addProduct = (product: ProductHit) => {
    setProducts((prev) => {
      if (prev.some((item) => item.id === product.id)) return prev;
      if (prev.length >= MAX_PRODUCTS) {
        void Taro.showToast({ title: `最多关联 ${MAX_PRODUCTS} 个商品`, icon: 'none' });
        return prev;
      }
      return [...prev, product];
    });
    setHits([]);
    setKeyword('');
  };

  const submit = async () => {
    if (!categoryId) {
      await Taro.showToast({ title: '请选择内容类目', icon: 'none' });
      return;
    }
    if (!content.trim() && !images.length) {
      await Taro.showToast({ title: '请填写正文或上传图片', icon: 'none' });
      return;
    }
    setSubmitting(true);
    try {
      const imageKeys = images.length ? await uploadImages(images) : [];
      const result = await api<{ status: string; message: string }>('/circle/posts', {
        method: 'POST',
        body: {
          content: content.trim(),
          categoryId,
          ...(imageKeys.length ? { images: imageKeys } : {}),
          ...(topicIds.length ? { topicIds } : {}),
          ...(products.length ? { productIds: products.map((item) => item.id) } : {}),
        },
      });
      await Taro.showToast({ title: result.message, icon: 'none', duration: 1600 });
      setTimeout(() => {
        void Taro.redirectTo({ url: '/pages/circle-me/index' });
      }, 800);
    } catch (err) {
      showError(err);
      setSubmitting(false);
    }
  };

  if (loading) return <Loading />;

  if (!enabled) {
    return (
      <View className="page">
        <Empty text="圈子暂未开放" />
      </View>
    );
  }

  return (
    <View className="page page--bar">
      <View className="card">
        <Text className="section-title circle-title">图片（选填，最多 {MAX_IMAGES} 张）</Text>
        <View className="circle-images">
          {images.map((path, index) => (
            <View key={`${path}-${index}`} className="circle-image-wrap">
              <Image className="circle-image" src={path} mode="aspectFill" />
              <Text
                className="circle-image-remove"
                onClick={() => setImages((prev) => prev.filter((_, i) => i !== index))}
              >
                ×
              </Text>
            </View>
          ))}
          {images.length < MAX_IMAGES && (
            <View className="circle-image-add" onClick={() => void pickImages()}>
              <Text>＋</Text>
            </View>
          )}
        </View>
      </View>

      <View className="card">
        <Text className="section-title circle-title">正文</Text>
        <Textarea
          className="textarea"
          value={content}
          maxlength={MAX_CONTENT}
          placeholder="分享你的山野生活、使用心得或好物推荐…"
          onInput={(e) => setContent(e.detail.value)}
        />
        <Text className="muted tiny circle-counter">
          {content.length} / {MAX_CONTENT}
        </Text>
      </View>

      <View className="card">
        <Text className="section-title circle-title">类目（必选）</Text>
        <View className="circle-chips">
          {categories.map((item) => (
            <View
              key={item.id}
              className={`circle-chip${item.id === categoryId ? ' circle-chip--on' : ''}`}
              onClick={() => {
                setCategoryId(item.id);
                setTopicIds([]);
              }}
            >
              {item.name}
            </View>
          ))}
        </View>
      </View>

      {visibleTopics.length > 0 && (
        <View className="card">
          <Text className="section-title circle-title">
            话题（选填，最多 {MAX_TOPICS} 个）
          </Text>
          <View className="circle-chips">
            {visibleTopics.map((topic) => (
              <View
                key={topic.id}
                className={`circle-chip${topicIds.includes(topic.id) ? ' circle-chip--on' : ''}`}
                onClick={() => toggleTopic(topic.id)}
              >
                #{topic.name}
              </View>
            ))}
          </View>
        </View>
      )}

      <View className="card">
        <Text className="section-title circle-title">关联商品（选填，最多 {MAX_PRODUCTS} 个）</Text>
        {products.length > 0 && (
          <View className="circle-products">
            {products.map((product) => (
              <View key={product.id} className="circle-product">
                <Image
                  className="circle-product-thumb"
                  src={imageSrc(product.mainImageKey ?? '')}
                  mode="aspectFill"
                />
                <View className="grow col">
                  <Text className="small ellipsis">{product.title}</Text>
                  <Text className="price tiny">{money(product.priceMinCents)}</Text>
                </View>
                <Text
                  className="muted"
                  onClick={() =>
                    setProducts((prev) => prev.filter((item) => item.id !== product.id))
                  }
                >
                  ×
                </Text>
              </View>
            ))}
          </View>
        )}
        <View className="row circle-search">
          <Input
            className="input grow"
            value={keyword}
            placeholder="搜索商品名称"
            onInput={(e) => setKeyword(e.detail.value)}
            onConfirm={() => void searchProducts()}
          />
          <View className="btn btn--ghost" onClick={() => void searchProducts()}>
            {searching ? '搜索中' : '搜索'}
          </View>
        </View>
        {hits.length > 0 && (
          <View className="circle-hits">
            {hits.map((product) => (
              <View key={product.id} className="circle-hit" onClick={() => addProduct(product)}>
                <Image
                  className="circle-product-thumb"
                  src={imageSrc(product.mainImageKey ?? '')}
                  mode="aspectFill"
                />
                <Text className="small ellipsis grow">{product.title}</Text>
                <Text className="brand tiny">添加</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View className="bottom-bar">
        <View
          className={`btn btn--primary btn--block${submitting ? ' btn--disabled' : ''}`}
          onClick={() => void submit()}
        >
          {submitting ? '发布中…' : '发布'}
        </View>
      </View>
    </View>
  );
}
