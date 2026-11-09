import { ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useState } from 'react';

import { api, showError } from '../../api/client';
import { Loading } from '../../components/common';
import { money } from '../../utils/format';

import './deliveries.css';

type Tab = 'PENDING' | 'ACCEPTED' | 'DELIVERED';

interface DeliveryRow {
  id: string;
  orderId: string;
  orderNo: string;
  status: string;
  overdue: boolean;
  courierName: string | null;
  courierPhone: string | null;
  createdAt: string;
  deliveredAt: string | null;
  receiver: string | null;
  phone: string | null;
  address: string | null;
  slot: string | null;
  payableCents: number;
  items: { title: string; specText: string; quantity: number }[];
}

interface PageResult {
  total: number;
  items: DeliveryRow[];
}

const TABS: { value: Tab; label: string }[] = [
  { value: 'PENDING', label: '待接单' },
  { value: 'ACCEPTED', label: '配送中' },
  { value: 'DELIVERED', label: '已完成' },
];

const STATUS_LABEL: Record<string, string> = {
  PENDING: '待接单',
  ACCEPTED: '配送中',
  DELIVERED: '已完成',
  CANCELLED: '已取消',
};

export default function Page() {
  const router = useRouter();
  const initial = (router.params.tab as Tab) || 'PENDING';
  const [tab, setTab] = useState<Tab>(TABS.some((item) => item.value === initial) ? initial : 'PENDING');
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');

  const load = async (next: Tab = tab) => {
    setLoading(true);
    try {
      const result = await api<PageResult>('/store-console/deliveries', {
        query: { status: next, pageSize: 20 },
      });
      setRows(result.items);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => {
    void load();
  });

  async function switchTab(next: Tab) {
    setTab(next);
    await load(next);
  }

  async function accept(row: DeliveryRow) {
    setActing(row.id);
    try {
      await api(`/store-console/deliveries/${row.id}/accept`, {
        method: 'POST',
        body: {},
      });
      await Taro.showToast({ title: '已接单', icon: 'success' });
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setActing('');
    }
  }

  async function deliver(row: DeliveryRow) {
    const confirmed = await Taro.showModal({
      title: '确认送达？',
      content: `订单 ${row.orderNo} 送达后即完成，顾客会收到通知。`,
      confirmText: '确认送达',
    });
    if (!confirmed.confirm) return;
    setActing(row.id);
    try {
      await api(`/store-console/deliveries/${row.id}/deliver`, { method: 'POST', body: {} });
      await Taro.showToast({ title: '已送达', icon: 'success' });
      await load();
    } catch (err) {
      showError(err);
    } finally {
      setActing('');
    }
  }

  async function call(phone: string | null) {
    if (!phone) {
      await Taro.showToast({ title: '顾客未留电话', icon: 'none' });
      return;
    }
    await Taro.makePhoneCall({ phoneNumber: phone });
  }

  return (
    <View className="page page--flush">
      <View className="delivery-tabs">
        {TABS.map((item) => (
          <View
            key={item.value}
            className={`delivery-tab${tab === item.value ? ' active' : ''}`}
            onClick={() => void switchTab(item.value)}
          >
            <Text>{item.label}</Text>
          </View>
        ))}
      </View>

      {loading ? (
        <Loading />
      ) : (
        <ScrollView scrollY className="delivery-list">
          {!rows.length && <Text className="delivery-empty">暂无配送单</Text>}
          {rows.map((row) => (
            <View className="delivery-card" key={row.id}>
              <View className="row-between">
                <Text className="delivery-no">{row.orderNo}</Text>
                <Text className={`delivery-tag${row.overdue ? ' is-overdue' : ''}`}>
                  {row.overdue ? '超时' : STATUS_LABEL[row.status] ?? row.status}
                </Text>
              </View>

              <View className="delivery-line">
                <Text className="grow small">{row.receiver ?? '顾客'}</Text>
                <Text className="delivery-link" onClick={() => void call(row.phone)}>
                  拨号
                </Text>
              </View>
              <Text className="muted tiny delivery-address">{row.address}</Text>

              <View className="row-between delivery-foot">
                <Text className="muted tiny">
                  {row.slot ? `${row.slot} 送达` : '未指定时段'} · {money(row.payableCents)}
                </Text>
                {tab === 'PENDING' && (
                  <View
                    className={`delivery-btn${acting === row.id ? ' is-disabled' : ''}`}
                    onClick={() => (acting === row.id ? undefined : void accept(row))}
                  >
                    <Text>接单</Text>
                  </View>
                )}
                {tab === 'ACCEPTED' && (
                  <View
                    className={`delivery-btn delivery-btn--primary${
                      acting === row.id ? ' is-disabled' : ''
                    }`}
                    onClick={() => (acting === row.id ? undefined : void deliver(row))}
                  >
                    <Text>送达</Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
