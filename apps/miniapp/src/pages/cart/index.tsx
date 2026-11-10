import { Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useState } from 'react';

import { api, showError } from '../../api/client';
import { AppTabBar } from '../../components/AppTabBar';
import { Empty, Loading, Price, ProductThumb } from '../../components/common';
import { specText } from '../../utils/format';

import './index.css';

interface CartItem {
  id: string;
  skuId: string;
  quantity: number;
  checked: boolean;
  title: string;
  spec: Record<string, string> | null;
  imageKey: string | null;
  priceCents: number;
  available: number;
  subtotalCents: number;
  invalidReason?: string;
}

interface CartData {
  valid: CartItem[];
  invalid: CartItem[];
  summary: { checkedCount: number; checkedAmountCents: number };
}

export default function Page() {
  const [cart, setCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    try {
      setCart(await api<CartData>('/cart'));
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => {
    void load();
  });

  const toggleChecked = async (item: CartItem) => {
    try {
      await api(`/cart/items/${item.id}`, {
        method: 'PATCH',
        body: { checked: !item.checked },
      });
      await load();
    } catch (err) {
      showError(err);
    }
  };

  const changeQuantity = async (item: CartItem, delta: number) => {
    const next = item.quantity + delta;
    if (next < 1) return;
    if (next > item.available) {
      await Taro.showToast({ title: `仅剩 ${item.available} 件`, icon: 'none' });
      return;
    }
    try {
      await api(`/cart/items/${item.id}`, { method: 'PATCH', body: { quantity: next } });
      await load();
    } catch (err) {
      showError(err);
    }
  };

  const remove = async (ids: string[]) => {
    const res = await Taro.showModal({ title: '确认删除', content: '删除后不可恢复' });
    if (!res.confirm) return;
    try {
      await api('/cart/items', { method: 'DELETE', body: { ids } });
      await load();
    } catch (err) {
      showError(err);
    }
  };

  const clearInvalid = async () => {
    try {
      await api('/cart/invalid', { method: 'DELETE' });
      await load();
    } catch (err) {
      showError(err);
    }
  };

  const goCheckout = () => {
    if (!cart?.summary.checkedCount) {
      void Taro.showToast({ title: '请先勾选商品', icon: 'none' });
      return;
    }
    void Taro.navigateTo({ url: '/pages/checkout/index' });
  };

  if (loading && !cart) return <Loading />;
  if (!cart) return <Empty text="购物车加载失败" />;

  const empty = !cart.valid.length && !cart.invalid.length;

  return (
    <View className={`page${empty ? '' : ' page--bar'}`}>
      {empty && (
        <View>
          <Empty text="购物车还是空的" />
          <View
            className="btn btn--primary cart-empty-btn"
            onClick={() => Taro.reLaunch({ url: '/pages/home/index' })}
          >
            去逛逛
          </View>
        </View>
      )}

      {cart.valid.map((item) => (
        <View key={item.id} className="card cart-item">
          <View
            className={`cart-check${item.checked ? ' cart-check--on' : ''}`}
            onClick={() => toggleChecked(item)}
          >
            {item.checked ? '✓' : ''}
          </View>
          <ProductThumb imageKey={item.imageKey} title={item.title} />
          <View className="grow cart-item-body">
            <Text className="cart-item-title clamp-2">{item.title}</Text>
            <Text className="muted tiny">{specText(item.spec)}</Text>
            <View className="row-between cart-item-foot">
              <Price cents={item.priceCents} />
              <View className="stepper">
                <Text onClick={() => changeQuantity(item, -1)}>−</Text>
                <Text className="stepper-value">{item.quantity}</Text>
                <Text onClick={() => changeQuantity(item, 1)}>＋</Text>
              </View>
            </View>
          </View>
        </View>
      ))}

      {!!cart.invalid.length && (
        <>
          <View className="row-between section-title">
            <Text>失效商品</Text>
            <Text className="muted tiny" onClick={clearInvalid}>
              清空失效
            </Text>
          </View>
          {cart.invalid.map((item) => (
            <View key={item.id} className="card cart-item cart-item--invalid">
              <Text className="tag">失效</Text>
              <ProductThumb imageKey={item.imageKey} title={item.title} />
              <View className="grow cart-item-body">
                <Text className="cart-item-title clamp-2">{item.title}</Text>
                <Text className="muted tiny">
                  {specText(item.spec)} · {item.invalidReason ?? '不可购买'}
                </Text>
                <View className="row-between cart-item-foot">
                  <Price cents={item.priceCents} />
                  <Text className="muted tiny" onClick={() => remove([item.id])}>
                    删除
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </>
      )}

      {!empty && (
        <>
          <View className="row-between cart-edit-row">
            <Text className="muted tiny" onClick={() => setEditing((prev) => !prev)}>
              {editing ? '完成' : '管理'}
            </Text>
            {editing && (
              <Text
                className="muted tiny"
                onClick={() => remove(cart.valid.map((item) => item.id))}
              >
                删除全部
              </Text>
            )}
          </View>
          <View className="bottom-bar">
            <View className="col grow">
              <Text className="tiny muted">
                已选 {cart.summary.checkedCount} 件 · 合计
              </Text>
              <Price cents={cart.summary.checkedAmountCents} />
            </View>
            <View
              className={`btn btn--primary${cart.summary.checkedCount ? '' : ' btn--disabled'}`}
              onClick={goCheckout}
            >
              去结算
            </View>
          </View>
        </>
      )}
      <AppTabBar />
    </View>
  );
}
