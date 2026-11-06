import { Input, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';

import { api, showError } from '../../../api/client';
import { Loading } from '../../../components/common';

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
  const id = router.params.id ?? '';
  const [receiver, setReceiver] = useState('');
  const [phone, setPhone] = useState('');
  const [region, setRegion] = useState('');
  const [detail, setDetail] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const res = await api<{ items: Address[] }>('/addresses');
        const target = res.items.find((item) => item.id === id);
        if (target) {
          setReceiver(target.receiver);
          setPhone(target.phone);
          setRegion(target.region);
          setDetail(target.detail);
          setIsDefault(target.isDefault);
        }
      } catch (err) {
        showError(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const save = async () => {
    if (!receiver.trim()) {
      await Taro.showToast({ title: '请填写收货人', icon: 'none' });
      return;
    }
    if (!/^1\d{10}$/.test(phone.trim())) {
      await Taro.showToast({ title: '手机号格式不正确', icon: 'none' });
      return;
    }
    if (!region.trim() || !detail.trim()) {
      await Taro.showToast({ title: '请填写完整地址', icon: 'none' });
      return;
    }

    setSaving(true);
    try {
      const body = {
        receiver: receiver.trim(),
        phone: phone.trim(),
        region: region.trim(),
        detail: detail.trim(),
        isDefault,
      };
      if (id) {
        await api(`/addresses/${id}`, { method: 'PATCH', body });
      } else {
        await api('/addresses', { method: 'POST', body });
      }
      await Taro.showToast({ title: '已保存', icon: 'success' });
      await Taro.navigateBack();
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <View className="page page--bar">
      <View className="card">
        <View className="field">
          <Text className="field-label">收货人</Text>
          <Input
            className="input"
            value={receiver}
            placeholder="请填写收货人姓名"
            onInput={(e) => setReceiver(e.detail.value)}
          />
        </View>
        <View className="field">
          <Text className="field-label">手机号</Text>
          <Input
            className="input"
            type="number"
            maxlength={11}
            value={phone}
            placeholder="请填写 11 位手机号"
            onInput={(e) => setPhone(e.detail.value)}
          />
        </View>
        <View className="field">
          <Text className="field-label">所在地区</Text>
          <Input
            className="input"
            value={region}
            placeholder="如：云南省昆明市五华区"
            onInput={(e) => setRegion(e.detail.value)}
          />
        </View>
        <View className="field ae-last-field">
          <Text className="field-label">详细地址</Text>
          <Input
            className="input"
            value={detail}
            placeholder="街道、门牌号、楼层等"
            onInput={(e) => setDetail(e.detail.value)}
          />
        </View>
      </View>

      <View className="card row-between">
        <View className="col">
          <Text className="small">设为默认地址</Text>
          <Text className="muted tiny">结算时优先使用</Text>
        </View>
        <View
          className={`ae-switch${isDefault ? ' ae-switch--on' : ''}`}
          onClick={() => setIsDefault((prev) => !prev)}
        >
          <View className="ae-switch-knob" />
        </View>
      </View>

      <View className="bottom-bar">
        <View
          className={`btn btn--primary btn--block${saving ? ' btn--disabled' : ''}`}
          onClick={save}
        >
          {saving ? '保存中…' : '保存地址'}
        </View>
      </View>
    </View>
  );
}
