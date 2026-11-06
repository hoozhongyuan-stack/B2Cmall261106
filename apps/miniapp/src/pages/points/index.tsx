import { Text, View } from '@tarojs/components';

import { api } from '../../api/client';
import { Empty, Loading } from '../../components/common';
import { useRequest } from '../../hooks/useRequest';
import { formatDate } from '../../utils/format';

import './index.css';

interface PointRecord {
  id: string;
  delta: number;
  source: string;
  reason: string;
  balanceAfter: number;
  createdAt: string;
}

interface PointsData {
  balance: number;
  items: PointRecord[];
}

const SOURCE_LABEL: Record<string, string> = {
  ORDER_PAID: '订单支付',
  REFUND: '退款扣回',
  ADMIN: '后台调整',
};

export default function Page() {
  const { data, loading } = useRequest(() => api<PointsData>('/member/points'));

  if (loading && !data) return <Loading />;

  return (
    <View className="page">
      <View className="hero points-hero">
        <Text className="points-label">当前积分</Text>
        <Text className="points-balance">{data?.balance ?? 0}</Text>
        <Text className="points-note">积分仅记录，不参与抵扣</Text>
      </View>

      <View className="section-title">积分流水</View>
      {!data?.items.length && <Empty text="暂无积分记录" />}

      {!!data?.items.length && (
        <View className="list">
          {data.items.map((record) => (
            <View key={record.id} className="list-item">
              <View className="grow col">
                <Text className="small">{record.reason}</Text>
                <Text className="muted tiny">
                  {SOURCE_LABEL[record.source] ?? record.source} ·{' '}
                  {formatDate(record.createdAt, true)}
                </Text>
              </View>
              <View className="col points-right">
                <Text className={`points-delta${record.delta >= 0 ? ' points-delta--up' : ''}`}>
                  {record.delta >= 0 ? '+' : ''}
                  {record.delta}
                </Text>
                <Text className="muted tiny">余额 {record.balanceAfter}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
