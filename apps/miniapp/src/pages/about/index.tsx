import { Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';

import { api } from '../../api/client';
import { Loading, imageSrc } from '../../components/common';

import './index.css';

interface ShopProfile {
  shopName: string;
  intro: string | null;
  logoKey: string | null;
  servicePhone: string | null;
  serviceEmail: string | null;
  serviceWechat: string | null;
  serviceHours: string | null;
  companyAddress: string | null;
  companyName: string | null;
  creditCode: string | null;
  icpNumber: string | null;
  icpUrl: string | null;
  policeNumber: string | null;
  policeUrl: string | null;
  officialSiteUrl: string | null;
}

interface Row {
  label: string;
  value: string;
  action?: 'phone' | 'copy' | 'open';
  target?: string;
}

const ICP_DEFAULT_URL = 'https://beian.miit.gov.cn/';

function appVersion(): string {
  // H5 不支持 getAccountInfoSync，调用会抛 errMsg 并触发未处理拒绝
  if (process.env.TARO_ENV !== 'weapp') return '';
  try {
    const info = Taro.getAccountInfoSync();
    return info?.miniProgram?.version ?? '';
  } catch {
    return '';
  }
}

export default function Page() {
  const [shop, setShop] = useState<ShopProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Taro.setNavigationBarTitle({ title: '关于我们' });
    api<ShopProfile>('/shop', { auth: 'optional' })
      .then(setShop)
      .catch(() => setShop(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading && !shop) return <Loading />;

  const name = shop?.shopName || '山野';
  const initial = name.slice(0, 1);

  const contactRows: Row[] = [];
  if (shop?.servicePhone) {
    contactRows.push({
      label: '客服电话',
      value: shop.servicePhone,
      action: 'phone',
      target: shop.servicePhone,
    });
  }
  if (shop?.serviceHours) {
    contactRows.push({ label: '服务时间', value: shop.serviceHours });
  }
  if (shop?.serviceEmail) {
    contactRows.push({
      label: '客服邮箱',
      value: shop.serviceEmail,
      action: 'copy',
      target: shop.serviceEmail,
    });
  }
  if (shop?.serviceWechat) {
    contactRows.push({
      label: '客服微信',
      value: shop.serviceWechat,
      action: 'copy',
      target: shop.serviceWechat,
    });
  }
  if (shop?.companyAddress) {
    contactRows.push({ label: '公司地址', value: shop.companyAddress });
  }

  const legalRows: Row[] = [];
  if (shop?.companyName) legalRows.push({ label: '运营主体', value: shop.companyName });
  if (shop?.creditCode) legalRows.push({ label: '信用代码', value: shop.creditCode });
  if (shop?.icpNumber) {
    legalRows.push({
      label: 'ICP 备案',
      value: shop.icpNumber,
      action: 'open',
      target: shop.icpUrl || ICP_DEFAULT_URL,
    });
  }
  if (shop?.policeNumber) {
    legalRows.push({
      label: '公安备案',
      value: shop.policeNumber,
      action: 'open',
      target: shop.policeUrl || '',
    });
  }
  if (shop?.officialSiteUrl) {
    legalRows.push({
      label: '官方商城',
      value: shop.officialSiteUrl,
      action: 'open',
      target: shop.officialSiteUrl,
    });
  }

  async function handleRow(row: Row) {
    if (!row.action) return;
    if (row.action === 'phone') {
      await Taro.makePhoneCall({ phoneNumber: row.target ?? row.value });
      return;
    }
    if (row.action === 'open' && row.target) {
      if (process.env.TARO_ENV === 'h5') {
        window.open(row.target, '_blank');
      } else {
        await Taro.setClipboardData({ data: row.target });
      }
      return;
    }
    await Taro.setClipboardData({ data: row.value });
  }

  return (
    <View className="page about-page">
      <View className="about-brand">
        <View className="about-logo">
          {shop?.logoKey ? (
            <Image className="about-logo-img" src={imageSrc(shop.logoKey)} mode="aspectFill" />
          ) : (
            <Text>{initial}</Text>
          )}
        </View>
        <Text className="about-name">{name}</Text>
        {shop?.intro ? <Text className="muted small about-intro">{shop.intro}</Text> : null}
      </View>

      {contactRows.length > 0 && (
        <View className="about-group">
          <Text className="about-group-title">联系我们</Text>
          <View className="list">
            {contactRows.map((row) => (
              <View
                key={row.label}
                className="list-item"
                onClick={() => void handleRow(row)}
              >
                <Text className="grow small">{row.label}</Text>
                <Text className="muted tiny about-value">{row.value}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {legalRows.length > 0 && (
        <View className="about-group">
          <Text className="about-group-title">主体与备案</Text>
          <View className="list">
            {legalRows.map((row) => (
              <View
                key={row.label}
                className="list-item"
                onClick={() => void handleRow(row)}
              >
                <Text className="grow small">{row.label}</Text>
                <Text className="muted tiny about-value">{row.value}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <Text className="muted tiny about-foot">
        {appVersion() ? `${name} v${appVersion()}` : name}
      </Text>
    </View>
  );
}
