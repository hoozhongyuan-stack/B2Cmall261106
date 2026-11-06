import { Text, View } from '@tarojs/components';
import { useRouter } from '@tarojs/taro';

import { api } from '../../api/client';
import { Empty, Loading } from '../../components/common';
import { useRequest } from '../../hooks/useRequest';
import { formatDate } from '../../utils/format';

import './index.css';

interface Shipment {
  shipped: boolean;
  expressName: string | null;
  expressCode: string | null;
  trackingNo: string | null;
  nodes: { time: string; title: string; desc: string }[];
  traceSource: string;
}

export default function Page() {
  const router = useRouter();
  const id = router.params.id ?? '';
  const { data, loading } = useRequest(() => api<Shipment>(`/orders/${id}/shipment`), [id]);

  if (loading && !data) return <Loading />;
  if (!data) return <Empty text="物流信息加载失败" />;

  return (
    <View className="page">
      {data.shipped ? (
        <View className="card">
          <View className="row-between">
            <Text className="small">{data.expressName}</Text>
            <Text className="muted tiny">{data.expressCode}</Text>
          </View>
          <Text className="ship-tracking">{data.trackingNo}</Text>
          <Text className="muted tiny">
            {data.traceSource === 'INTERNAL' ? '节点来自站内事件' : '节点来自快递查询'}
          </Text>
        </View>
      ) : (
        <View className="card ship-pending">
          <Text className="tag tag--brand">待发货</Text>
          <Text className="small ship-pending-text">商家正在打包，发货后可在此查看物流轨迹</Text>
        </View>
      )}

      {!!data.nodes.length && (
        <View className="card">
          <Text className="section-title ship-title">物流轨迹</Text>
          <View className="ship-timeline">
            {data.nodes.map((node, index) => (
              <View key={`${node.time}-${index}`} className="ship-node">
                <View className="ship-dot-wrap">
                  <View className={`ship-dot${index === 0 ? ' ship-dot--on' : ''}`} />
                  {index < data.nodes.length - 1 && <View className="ship-line" />}
                </View>
                <View className="grow col ship-node-body">
                  <Text className="small ship-node-title">{node.title}</Text>
                  <Text className="muted tiny">{node.desc}</Text>
                  <Text className="muted tiny">{formatDate(node.time, true)}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {!data.nodes.length && <Empty text="暂无物流节点" />}
    </View>
  );
}
