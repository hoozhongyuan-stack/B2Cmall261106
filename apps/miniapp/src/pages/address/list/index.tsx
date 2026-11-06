import { Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useState } from 'react';

import { api, showError } from '../../../api/client';
import { Empty, Loading } from '../../../components/common';

import './index.css';

interface Address {
  id: string;
  receiver: string;
  phone: string;
  region: string;
  detail: string;
  isDefault: boolean;
}

export default function Page() {
  const router = useRouter();
  const selectMode = router.params.select === '1';
  const [items, setItems] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await api<{ items: Address[] }>('/addresses');
      setItems(res.items);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => {
    void load();
  });

  const pick = (address: Address) => {
    if (!selectMode) return;
    Taro.setStorageSync('checkout_address_id', address.id);
    void Taro.navigateBack();
  };

  const setDefault = async (address: Address) => {
    try {
      await api(`/addresses/${address.id}/default`, { method: 'POST' });
      await Taro.showToast({ title: '已保存', icon: 'success' });
      await load();
    } catch (err) {
      showError(err);
    }
  };

  const remove = async (address: Address) => {
    const modal = await Taro.showModal({ title: '删除地址', content: '确定删除这个收货地址？' });
    if (!modal.confirm) return;
    try {
      await api(`/addresses/${address.id}`, { method: 'DELETE' });
      await Taro.showToast({ title: '已保存', icon: 'success' });
      await load();
    } catch (err) {
      showError(err);
    }
  };

  if (loading && !items.length) return <Loading />;

  return (
    <View className="page page--bar">
      {!items.length && <Empty text="还没有收货地址" />}

      {items.map((address) => (
        <View key={address.id} className="card al-card" onClick={() => pick(address)}>
          <View className="row-between">
            <View className="row al-person">
              <Text className="al-name">{address.receiver}</Text>
              <Text className="muted small">{address.phone}</Text>
            </View>
            {address.isDefault && <Text className="tag tag--brand">默认</Text>}
          </View>
          <Text className="small muted al-detail">
            {address.region} {address.detail}
          </Text>

          <View className="row al-actions">
            {!address.isDefault && (
              <Text
                className="muted tiny al-action"
                onClick={(e) => {
                  e.stopPropagation();
                  void setDefault(address);
                }}
              >
                设为默认
              </Text>
            )}
            <Text
              className="muted tiny al-action"
              onClick={(e) => {
                e.stopPropagation();
                void Taro.navigateTo({ url: `/pages/address/edit/index?id=${address.id}` });
              }}
            >
              编辑
            </Text>
            <Text
              className="muted tiny al-action"
              onClick={(e) => {
                e.stopPropagation();
                void remove(address);
              }}
            >
              删除
            </Text>
          </View>
        </View>
      ))}

      <View className="bottom-bar">
        <View
          className="btn btn--primary btn--block"
          onClick={() => Taro.navigateTo({ url: '/pages/address/edit/index' })}
        >
          新增收货地址
        </View>
      </View>
    </View>
  );
}
