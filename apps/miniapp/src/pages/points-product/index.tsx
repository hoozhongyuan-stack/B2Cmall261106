import { Image, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useEffect, useState } from 'react';

import { api, showError } from '../../api/client';
import { Loading, PageState, imageSrc } from '../../components/common';
import { money } from '../../utils/format';
import { payOrder } from '../../utils/pay';

import './index.css';

interface Sku {
  id: string;
  spec: Record<string, string> | null;
  priceCents: number;
  pointsCost: number | null;
  pointsMoneyCents: number;
  available: number;
  status: string;
}

interface Detail {
  id: string;
  title: string;
  subtitle: string | null;
  detail: string | null;
  mainImageKey: string | null;
  mainImageKeys: string[];
  detailImageKeys: string[];
  channel: 'NORMAL' | 'POINTS';
  pointsLimitPerUser: number;
  skus: Sku[];
}

interface Limits {
  limit: number;
  used: number;
  remaining: number | null;
  balance: number;
}

interface Address {
  id: string;
  receiver: string;
  phone: string;
  region: string;
  detail: string;
  isDefault: boolean;
}

const ADDRESS_KEY = 'points_address_id';

export default function Page() {
  const router = useRouter();
  const id = router.params.id ?? '';
  const [product, setProduct] = useState<Detail | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [address, setAddress] = useState<Address | null>(null);
  const [skuId, setSkuId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function loadProduct() {
    try {
      const result = await api<Detail>(`/products/${id}`, { auth: 'optional' });
      setProduct(result);
      setSkuId((prev) => prev || result.skus.find((sku) => sku.available > 0)?.id || result.skus[0]?.id || '');
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadLimits() {
    try {
      setLimits(await api<Limits>('/member/points-mall/limits', { query: { productId: id } }));
    } catch (err) {
      showError(err);
    }
  }

  async function loadAddress() {
    try {
      const result = await api<{ items: Address[] }>('/addresses');
      const pickedId = Taro.getStorageSync<string>(ADDRESS_KEY);
      const picked = result.items.find((item) => item.id === pickedId);
      setAddress(picked ?? result.items.find((item) => item.isDefault) ?? result.items[0] ?? null);
    } catch (err) {
      showError(err);
    }
  }

  useEffect(() => {
    void loadProduct();
    void loadLimits();
  }, [id]);

  useDidShow(() => {
    void loadAddress();
  });

  const sku = product?.skus.find((item) => item.id === skuId) ?? product?.skus[0];
  const pointsCost = sku?.pointsCost ?? 0;
  const moneyCents = sku?.pointsMoneyCents ?? 0;
  const totalPoints = pointsCost * quantity;
  const totalMoney = moneyCents * quantity;
  const available = sku?.available ?? 0;
  const maxByLimit = limits?.remaining ?? Number.MAX_SAFE_INTEGER;
  const maxQuantity = Math.max(Math.min(available, maxByLimit), 0);
  const insufficient = (limits?.balance ?? 0) < totalPoints;
  const soldOut = maxQuantity <= 0;
  const canRedeem = !soldOut && !insufficient && Boolean(address);

  function changeQuantity(delta: number) {
    setQuantity((prev) => Math.min(Math.max(prev + delta, 1), Math.max(maxQuantity, 1)));
  }

  async function redeem() {
    if (!product || !sku || submitting) return;
    if (!address) {
      await Taro.showToast({ title: '请先添加收货地址', icon: 'none' });
      return;
    }
    if (insufficient) {
      await Taro.showToast({ title: `还差 ${totalPoints - (limits?.balance ?? 0)} 积分`, icon: 'none' });
      return;
    }
    const modal = await Taro.showModal({
      title: '确认兑换',
      content: `消耗 ${totalPoints} 积分${totalMoney > 0 ? ` + ${money(totalMoney)}` : ''}，兑换 ${product.title} × ${quantity}`,
    });
    if (!modal.confirm) return;

    setSubmitting(true);
    try {
      const order = await api<{
        orderId: string;
        payableCents: number;
        pointsUsed: number;
        needsPay: boolean;
      }>('/member/points-mall/orders', {
        method: 'POST',
        headers: {
          'Idempotency-Key': `points-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
        body: {
          skuId: sku.id,
          quantity,
          addressId: address.id,
          fulfillmentType: 'EXPRESS',
        },
      });
      const outcome = order.needsPay ? await payOrder(order.orderId) : 'paid';
      await Taro.redirectTo({
        url: `/pages/pay-result/index?orderId=${order.orderId}&status=${outcome === 'paid' ? 'success' : 'pending'}`,
      });
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !product) return <Loading />;
  if (!product) return <PageState loading={false} empty text="积分商品不存在或已下架" />;

  const images =
    product.mainImageKeys?.length > 0
      ? product.mainImageKeys
      : product.mainImageKey
        ? [product.mainImageKey]
        : [];

  return (
    <View className="page page--bar pp">
      <View className="pp-gallery">
        {images.length ? (
          <Image className="pp-cover" src={imageSrc(images[0])} mode="aspectFill" />
        ) : (
          <View className="pp-cover pp-cover--empty">{product.title.slice(0, 1)}</View>
        )}
      </View>

      <View className="card pp-summary">
        <View className="row pp-price-row">
          <Text className="pp-points">{pointsCost}</Text>
          <Text className="pp-unit">积分</Text>
          {moneyCents > 0 && <Text className="pp-money">+ {money(moneyCents)}</Text>}
        </View>
        <Text className="pp-title">{product.title}</Text>
        {product.subtitle ? <Text className="muted small">{product.subtitle}</Text> : null}
        <View className="row pp-tags">
          <Text className="tag tag--muted">库存 {available}</Text>
          <Text className="tag tag--muted">
            {product.pointsLimitPerUser > 0
              ? `每人限兑 ${product.pointsLimitPerUser} 件`
              : '不限兑换'}
          </Text>
          {limits && limits.remaining !== null ? (
            <Text className="tag tag--brand">还可兑 {limits.remaining} 件</Text>
          ) : null}
        </View>
      </View>

      <View className="card pp-address" onClick={() => void Taro.navigateTo({ url: `/pages/address/list/index?select=1&key=${ADDRESS_KEY}` })}>
        {address ? (
          <>
            <View className="row-between">
              <Text className="pp-address-name">{address.receiver}</Text>
              <Text className="muted small">{address.phone}</Text>
            </View>
            <Text className="small muted pp-address-detail">
              {address.region} {address.detail}
            </Text>
          </>
        ) : (
          <Text className="pp-address-empty">+ 添加收货地址</Text>
        )}
      </View>

      {product.skus.filter((item) => item.pointsCost !== null).length > 1 && (
        <View className="card pp-skus">
          <Text className="pp-label">选择规格</Text>
          <View className="row pp-sku-list">
            {product.skus
              .filter((item) => item.pointsCost !== null)
              .map((item) => (
                <View
                  key={item.id}
                  className={`pp-sku${item.id === skuId ? ' is-active' : ''}`}
                  onClick={() => {
                    setSkuId(item.id);
                    setQuantity(1);
                  }}
                >
                  {Object.values(item.spec ?? {}).join(' / ') || '默认规格'}
                </View>
              ))}
          </View>
        </View>
      )}

      <View className="card pp-quantity">
        <Text className="pp-label">兑换数量</Text>
        <View className="row pp-stepper">
          <Text className="pp-step" onClick={() => changeQuantity(-1)}>
            −
          </Text>
          <Text className="pp-step-value">{quantity}</Text>
          <Text className="pp-step" onClick={() => changeQuantity(1)}>
            +
          </Text>
        </View>
      </View>

      <View className="bottom-bar">
        <View className="col pp-total">
          <View className="row pp-total-row">
            <Text className="pp-total-points">{totalPoints}</Text>
            <Text className="muted small">积分</Text>
            {totalMoney > 0 && <Text className="pp-total-money">+ {money(totalMoney)}</Text>}
          </View>
          <Text className="muted tiny">当前余额 {limits?.balance ?? 0} 积分</Text>
        </View>
        <View
          className={`btn btn--primary pp-submit${canRedeem ? '' : ' is-disabled'}`}
          onClick={() => {
            if (canRedeem) void redeem();
            else if (!address) void Taro.showToast({ title: '请先添加收货地址', icon: 'none' });
            else if (soldOut) void Taro.showToast({ title: '已兑完', icon: 'none' });
            else void Taro.showToast({ title: `还差 ${totalPoints - (limits?.balance ?? 0)} 积分`, icon: 'none' });
          }}
        >
          {soldOut ? '已兑完' : insufficient ? '积分不足' : submitting ? '兑换中…' : '立即兑换'}
        </View>
      </View>
    </View>
  );
}
