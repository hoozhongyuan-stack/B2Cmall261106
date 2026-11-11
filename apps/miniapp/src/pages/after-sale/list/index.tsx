import { Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useState } from 'react';
import { AFTER_SALE_STATUS_LABEL, type AfterSaleStatus } from '@shanye/shared/src/orderState';

import { api, showError } from '../../../api/client';
import { PageState } from '../../../components/common';
import { formatDate, money } from '../../../utils/format';

import './index.css';

interface AfterSaleRow {
  id: string;
  afterSaleNo: string;
  type: string;
  status: string;
  refundCents: number;
  createdAt: string;
  orderNo: string | null;
  item: { title: string; specText: string; priceCents: number; quantity: number } | null;
}

const TYPE_LABEL: Record<string, string> = {
  REFUND_ONLY: '仅退款',
  RETURN_REFUND: '退货退款',
};

export default function Page() {
  const [items, setItems] = useState<AfterSaleRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await api<{ items: AfterSaleRow[] }>('/after-sales');
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

  return (
    <PageState loading={loading && !items.length} empty={!items.length} text="暂无售后记录">
      <View className="page">
        {items.map((record) => (
          <View
            key={record.id}
            className="card as-card"
            onClick={() =>
              Taro.navigateTo({ url: `/pages/after-sale/detail/index?id=${record.id}` })
            }
          >
            <View className="row-between">
              <Text className="muted tiny">{record.afterSaleNo}</Text>
              <Text className="as-status">
                {AFTER_SALE_STATUS_LABEL[record.status as AfterSaleStatus]}
              </Text>
            </View>
            <Text className="small as-item-title">
              {record.item?.title ?? '售后商品'}
              {record.item ? ` x${record.item.quantity}` : ''}
            </Text>
            {record.item?.specText && <Text className="muted tiny">{record.item.specText}</Text>}
            <View className="row-between as-foot">
              <Text className="muted tiny">
                {TYPE_LABEL[record.type] ?? record.type} · {formatDate(record.createdAt)}
              </Text>
              <Text className="price small">{money(record.refundCents)}</Text>
            </View>
          </View>
        ))}
      </View>
    </PageState>
  );
}
