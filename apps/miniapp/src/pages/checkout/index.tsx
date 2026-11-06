import { Text, Textarea, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useRef, useState } from 'react';

import { api, showError } from '../../api/client';
import { Empty, Loading, Price, ProductThumb } from '../../components/common';
import { formatDate, money } from '../../utils/format';

import './index.css';

const ADDRESS_KEY = 'checkout_address_id';

interface Address {
  id: string;
  receiver: string;
  phone: string;
  region: string;
  detail: string;
  isDefault: boolean;
}

interface PreviewItem {
  skuId: string;
  title: string;
  specText: string;
  imageKey: string | null;
  priceCents: number;
  quantity: number;
  subtotalCents: number;
}

interface AvailableCoupon {
  claimId: string;
  name: string;
  faceValueCents: number;
  thresholdCents: number;
  usable: boolean;
  expiresAt: string;
}

interface Preview {
  items: PreviewItem[];
  amount: {
    goodsCents: number;
    memberDiscountCents: number;
    couponCents: number;
    freightCents: number;
    payableCents: number;
  };
  member: { levelName: string; rate: number };
  coupon: { claimId: string; name: string } | null;
  availableCoupons: AvailableCoupon[];
  freight: { freeThresholdCents: number; flatCents: number; exceptionRegion: boolean };
}

interface CreatedOrder {
  id: string;
}

export default function Page() {
  const router = useRouter();
  const skuId = router.params.skuId ?? '';
  const quantity = Number(router.params.quantity ?? '1') || 1;
  const [address, setAddress] = useState<Address | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [couponClaimId, setCouponClaimId] = useState<string | null>(null);
  const [couponOpen, setCouponOpen] = useState(false);
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const autoPicked = useRef(false);

  const buildBody = (addr: Address | null, claimId: string | null) => ({
    ...(skuId ? { items: [{ skuId, quantity }] } : {}),
    ...(claimId ? { couponClaimId: claimId } : {}),
    ...(addr?.region ? { region: addr.region } : {}),
  });

  const requestPreview = (addr: Address | null, claimId: string | null) =>
    api<Preview>('/orders/preview', { method: 'POST', body: buildBody(addr, claimId) });

  const loadPreview = async (addr: Address | null, claimId: string | null) => {
    const res = await requestPreview(addr, claimId);
    setPreview(res);
    if (!claimId && !autoPicked.current) {
      autoPicked.current = true;
      const best = res.availableCoupons
        .filter((item) => item.usable)
        .sort((a, b) => b.faceValueCents - a.faceValueCents)[0];
      if (best) {
        setCouponClaimId(best.claimId);
        setPreview(await requestPreview(addr, best.claimId));
      }
    }
  };

  const init = async () => {
    try {
      const addresses = await api<{ items: Address[] }>('/addresses');
      const stored = Taro.getStorageSync<string>(ADDRESS_KEY);
      if (stored) Taro.removeStorageSync(ADDRESS_KEY);
      const chosen =
        addresses.items.find((item) => item.id === stored) ??
        addresses.items.find((item) => item.isDefault) ??
        addresses.items[0] ??
        null;
      setAddress(chosen);
      await loadPreview(chosen, couponClaimId);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => {
    void init();
  });

  const pickCoupon = async (claimId: string | null) => {
    setCouponClaimId(claimId);
    setCouponOpen(false);
    try {
      setPreview(await requestPreview(address, claimId));
    } catch (err) {
      showError(err);
    }
  };

  const chooseAddress = () => {
    void Taro.navigateTo({ url: '/pages/address/list/index?select=1' });
  };

  const submit = async () => {
    if (!address) {
      await Taro.showToast({ title: '请先选择收货地址', icon: 'none' });
      void Taro.navigateTo({ url: '/pages/address/edit/index' });
      return;
    }
    if (!preview || submitting) return;

    setSubmitting(true);
    try {
      const order = await api<CreatedOrder>('/orders', {
        method: 'POST',
        headers: {
          'Idempotency-Key': `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
        body: {
          ...buildBody(address, couponClaimId),
          addressId: address.id,
          remark: remark.trim() || undefined,
        },
      });
      const pay = await api<{ outTradeNo: string }>(`/orders/${order.id}/pay`, { method: 'POST' });
      await api('/payments/mock/confirm', {
        method: 'POST',
        body: { outTradeNo: pay.outTradeNo },
      });
      await Taro.redirectTo({
        url: `/pages/pay-result/index?orderId=${order.id}&status=success`,
      });
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !preview) return <Loading />;
  if (!preview) return <Empty text="没有可结算的商品" />;

  const usableCoupons = preview.availableCoupons.filter((item) => item.usable).length;

  return (
    <View className="page page--bar">
      <View className="card checkout-address" onClick={chooseAddress}>
        {address ? (
          <>
            <View className="row-between">
              <Text className="checkout-receiver">{address.receiver}</Text>
              <Text className="muted small">{address.phone}</Text>
            </View>
            <Text className="small muted checkout-address-text">
              {address.region} {address.detail}
            </Text>
          </>
        ) : (
          <Text className="small">请选择收货地址</Text>
        )}
        <Text className="muted tiny checkout-arrow">›</Text>
      </View>

      <View className="card">
        {preview.items.map((item) => (
          <View key={item.skuId} className="checkout-item">
            <ProductThumb imageKey={item.imageKey} title={item.title} />
            <View className="grow col">
              <Text className="clamp-2">{item.title}</Text>
              <Text className="muted tiny">{item.specText}</Text>
              <View className="row-between">
                <Price cents={item.priceCents} />
                <Text className="muted tiny">x{item.quantity}</Text>
              </View>
            </View>
          </View>
        ))}
      </View>

      <View className="card">
        <View className="checkout-row" onClick={() => setCouponOpen(true)}>
          <Text className="small">优惠券</Text>
          <Text className={preview.coupon ? 'price small' : 'muted small'}>
            {preview.coupon
              ? `${preview.coupon.name} −${money(preview.amount.couponCents)}`
              : usableCoupons
                ? `${usableCoupons} 张可用 ›`
                : '暂无可用 ›'}
          </Text>
        </View>
        <View className="checkout-row">
          <Text className="small">会员折扣</Text>
          <Text className="muted small">
            {preview.member.levelName} −{money(preview.amount.memberDiscountCents)}
          </Text>
        </View>
        <View className="checkout-row">
          <View className="col">
            <Text className="small">运费</Text>
            <Text className="muted tiny">
              {preview.amount.freightCents === 0
                ? `已满 ${money(preview.freight.freeThresholdCents)} 免运费`
                : `满 ${money(preview.freight.freeThresholdCents)} 免运费`}
              {preview.freight.exceptionRegion ? '；当前地区按例外运费计算' : ''}
            </Text>
          </View>
          <Text className="small">
            {preview.amount.freightCents === 0 ? '包邮' : money(preview.amount.freightCents)}
          </Text>
        </View>
      </View>

      <View className="card">
        <Text className="small checkout-remark-label">订单备注</Text>
        <Textarea
          className="textarea"
          value={remark}
          maxlength={100}
          placeholder="选填，可备注口味或配送要求"
          onInput={(e) => setRemark(e.detail.value)}
        />
      </View>

      <View className="card checkout-amount">
        <View className="row-between">
          <Text className="small muted">商品金额</Text>
          <Text className="small">{money(preview.amount.goodsCents)}</Text>
        </View>
        <View className="row-between">
          <Text className="small muted">优惠合计</Text>
          <Text className="small">
            −{money(preview.amount.memberDiscountCents + preview.amount.couponCents)}
          </Text>
        </View>
        <View className="row-between">
          <Text className="small muted">运费</Text>
          <Text className="small">{money(preview.amount.freightCents)}</Text>
        </View>
        <View className="row-between checkout-payable">
          <Text className="small">应付</Text>
          <Price cents={preview.amount.payableCents} />
        </View>
      </View>

      <View className="bottom-bar">
        <View className="col grow">
          <Text className="tiny muted">应付</Text>
          <Price cents={preview.amount.payableCents} />
        </View>
        <View
          className={`btn btn--primary${submitting ? ' btn--disabled' : ''}`}
          onClick={submit}
        >
          {submitting ? '提交中…' : '提交订单'}
        </View>
      </View>

      {couponOpen && (
        <View className="checkout-mask" onClick={() => setCouponOpen(false)}>
          <View className="checkout-sheet" onClick={(e) => e.stopPropagation()}>
            <View className="row-between">
              <Text className="title">选择优惠券</Text>
              <Text className="muted small" onClick={() => pickCoupon(null)}>
                不使用
              </Text>
            </View>
            <View className="checkout-coupons">
              {preview.availableCoupons.map((item) => (
                <View
                  key={item.claimId}
                  className={`checkout-coupon${item.usable ? '' : ' checkout-coupon--off'}${
                    couponClaimId === item.claimId ? ' checkout-coupon--on' : ''
                  }`}
                  onClick={() => item.usable && pickCoupon(item.claimId)}
                >
                  <View className="col grow">
                    <Text className="small">{item.name}</Text>
                    <Text className="tiny muted">
                      满 {money(item.thresholdCents)} 可用 · {formatDate(item.expiresAt)} 到期
                    </Text>
                  </View>
                  <Text className="price">{money(item.faceValueCents)}</Text>
                </View>
              ))}
              {!preview.availableCoupons.length && (
                <Text className="muted small checkout-no-coupon">暂无可用优惠券</Text>
              )}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
