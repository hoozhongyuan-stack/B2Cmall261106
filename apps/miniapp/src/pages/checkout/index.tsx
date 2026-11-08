import { Input, Text, Textarea, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { useRef, useState } from 'react';

import { api, showError } from '../../api/client';
import { Empty, Loading, Price, ProductThumb } from '../../components/common';
import { formatDate, money } from '../../utils/format';
import { payOrder } from '../../utils/pay';
import { requestSubscriptions } from '../../utils/subscribe';

import './index.css';

const ADDRESS_KEY = 'checkout_address_id';
const STORE_KEY = 'checkout_store_id';
const DELIVERY_STORE_KEY = 'checkout_delivery_store_id';

interface Address {
  id: string;
  receiver: string;
  phone: string;
  region: string;
  detail: string;
  isDefault: boolean;
}

interface Store {
  id: string;
  name: string;
  phone: string | null;
  region: string;
  address: string;
  businessHours: Record<string, string[][]>;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryFeeCents: number;
  freeDeliveryThresholdCents: number;
  deliverySlots: string[];
  deliveryCutoff: string | null;
  deliveryRegions: string[];
  notice: string | null;
}

interface PreviewItem {
  skuId: string;
  title: string;
  specText: string;
  imageKey: string | null;
  priceCents: number;
  quantity: number;
  subtotalCents: number;
  isSeckill?: boolean;
  originalPriceCents?: number;
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
    fullReductionCents: number;
    freightCents: number;
    payableCents: number;
  };
  member: { levelName: string; rate: number; cardName: string | null; freeShipping: boolean };
  coupon: { claimId: string; name: string } | null;
  fullReduction: { id: string; name: string; thresholdCents: number; discountCents: number } | null;
  availableCoupons: AvailableCoupon[];
  freight: { freeThresholdCents: number; flatCents: number; exceptionRegion: boolean };
}

interface CreatedOrder {
  id: string;
}

type FulfillmentMode = 'EXPRESS' | 'PICKUP' | 'DELIVERY';

function toMinutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function pickupSlots(store: Store | null): { value: string; label: string }[] {
  if (!store) return [];
  const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const now = new Date();
  const slots: { value: string; label: string }[] = [];

  for (let offset = 0; offset < 3; offset += 1) {
    const day = new Date(now);
    day.setDate(now.getDate() + offset);
    const key = weekdays[day.getDay()];
    const ranges = store.businessHours[key]?.length
      ? store.businessHours[key]
      : [['09:00', '18:00']];
    const prefix =
      offset === 0 ? '今天' : offset === 1 ? '明天' : `${day.getMonth() + 1}/${day.getDate()}`;

    for (const [open, close] of ranges) {
      let start = toMinutes(open);
      const end = toMinutes(close);
      while (start + 60 <= end) {
        const slotEnd = Math.min(start + 120, end);
        const value = `${toTime(start)}-${toTime(slotEnd)}`;
        const at = new Date(day);
        at.setHours(Math.floor(start / 60), start % 60, 0, 0);
        if (at.getTime() > now.getTime()) {
          slots.push({ value, label: `${prefix} ${value}` });
        }
        start = slotEnd;
      }
    }
  }
  return slots.slice(0, 12);
}

/** 同城配送时段：过滤已结束与已截单的时段，最终以服务端校验为准 */
function deliverySlots(store: Store | null): string[] {
  if (!store?.deliverySlots?.length) return [];
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const cutoffMin = store.deliveryCutoff ? toMinutes(store.deliveryCutoff) : null;
  if (cutoffMin !== null && nowMin >= cutoffMin) return [];

  return store.deliverySlots.filter((slot) => {
    const range = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(slot);
    if (!range) return false;
    return nowMin < toMinutes(range[2]);
  });
}

export default function Page() {
  const router = useRouter();
  const skuId = router.params.skuId ?? '';
  const quantity = Number(router.params.quantity ?? '1') || 1;
  const [address, setAddress] = useState<Address | null>(null);
  const [mode, setMode] = useState<FulfillmentMode>('EXPRESS');
  const [store, setStore] = useState<Store | null>(null);
  const [pickupSlot, setPickupSlot] = useState('');
  const [deliverySlot, setDeliverySlot] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [couponClaimId, setCouponClaimId] = useState<string | null>(null);
  const [couponOpen, setCouponOpen] = useState(false);
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const autoPicked = useRef(false);

  const buildBody = (
    addr: Address | null,
    claimId: string | null,
    nextMode: FulfillmentMode = mode,
    nextStore: Store | null = store,
    nextPickupSlot = pickupSlot,
    nextDeliverySlot = deliverySlot,
  ) => ({
    ...(skuId ? { items: [{ skuId, quantity }] } : {}),
    ...(claimId ? { couponClaimId: claimId } : {}),
    ...(nextMode !== 'PICKUP' && addr?.region ? { region: addr.region } : {}),
    fulfillmentType: nextMode,
    ...(nextMode !== 'EXPRESS' && nextStore ? { storeId: nextStore.id } : {}),
    ...(nextMode === 'PICKUP' && nextPickupSlot ? { pickupSlot: nextPickupSlot } : {}),
    ...(nextMode === 'DELIVERY' && nextDeliverySlot
      ? { deliverySlot: nextDeliverySlot }
      : {}),
  });

  const requestPreview = (
    addr: Address | null,
    claimId: string | null,
    nextMode: FulfillmentMode = mode,
    nextStore: Store | null = store,
    nextPickupSlot = pickupSlot,
    nextDeliverySlot = deliverySlot,
  ) =>
    api<Preview>('/orders/preview', {
      method: 'POST',
      body: buildBody(addr, claimId, nextMode, nextStore, nextPickupSlot, nextDeliverySlot),
    });

  const loadPreview = async (
    addr: Address | null,
    claimId: string | null,
    nextMode: FulfillmentMode = mode,
    nextStore: Store | null = store,
    nextPickupSlot = pickupSlot,
    nextDeliverySlot = deliverySlot,
  ) => {
    const res = await requestPreview(
      addr,
      claimId,
      nextMode,
      nextStore,
      nextPickupSlot,
      nextDeliverySlot,
    );
    setPreview(res);
    if (!claimId && !autoPicked.current) {
      autoPicked.current = true;
      const best = res.availableCoupons
        .filter((item) => item.usable)
        .sort((a, b) => b.faceValueCents - a.faceValueCents)[0];
      if (best) {
        setCouponClaimId(best.claimId);
        setPreview(
          await requestPreview(
            addr,
            best.claimId,
            nextMode,
            nextStore,
            nextPickupSlot,
            nextDeliverySlot,
          ),
        );
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
      if (!contactPhone && chosen?.phone) setContactPhone(chosen.phone);

      const storedPickupId = Taro.getStorageSync<string>(STORE_KEY);
      if (storedPickupId) Taro.removeStorageSync(STORE_KEY);
      const storedDeliveryId = Taro.getStorageSync<string>(DELIVERY_STORE_KEY);
      if (storedDeliveryId) Taro.removeStorageSync(DELIVERY_STORE_KEY);

      let nextStore = store;
      let nextMode: FulfillmentMode = mode;
      let nextPickupSlot = pickupSlot;
      let nextDeliverySlot = deliverySlot;
      if (storedDeliveryId) {
        nextStore = await api<Store>(`/stores/${storedDeliveryId}`);
        setStore(nextStore);
        nextMode = 'DELIVERY';
      } else if (storedPickupId) {
        nextStore = await api<Store>(`/stores/${storedPickupId}`);
        setStore(nextStore);
        nextMode = 'PICKUP';
      }
      if (storedDeliveryId || storedPickupId) {
        setMode(nextMode);
        nextPickupSlot = '';
        nextDeliverySlot = '';
        setPickupSlot('');
        setDeliverySlot('');
      }

      await loadPreview(
        chosen,
        couponClaimId,
        nextMode,
        nextStore,
        nextPickupSlot,
        nextDeliverySlot,
      );
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

  const chooseStore = (capability: 'PICKUP' | 'DELIVERY', region?: string) => {
    const query = [
      'select=1',
      `capability=${capability}`,
      region ? `region=${encodeURIComponent(region)}` : '',
    ]
      .filter(Boolean)
      .join('&');
    void Taro.navigateTo({ url: `/pages/store/list/index?${query}` });
  };

  const switchMode = async (next: FulfillmentMode) => {
    if (next === mode) return;
    if (next === 'DELIVERY' && !address) {
      await Taro.showToast({ title: '请先选择收货地址', icon: 'none' });
      chooseAddress();
      return;
    }
    setMode(next);
    // 门店与时段按履约方式重新选择，避免复用不支持当前方式的门店
    setStore(null);
    setPickupSlot('');
    setDeliverySlot('');
    if (next !== 'EXPRESS') {
      chooseStore(next, next === 'DELIVERY' ? address?.region : undefined);
      return;
    }
    try {
      setPreview(await requestPreview(address, couponClaimId, next, null, '', ''));
    } catch (err) {
      showError(err);
    }
  };

  const choosePickupSlot = async (value: string) => {
    setPickupSlot(value);
    try {
      setPreview(
        await requestPreview(address, couponClaimId, mode, store, value, deliverySlot),
      );
    } catch (err) {
      showError(err);
    }
  };

  const chooseDeliverySlot = async (value: string) => {
    setDeliverySlot(value);
    try {
      setPreview(
        await requestPreview(address, couponClaimId, 'DELIVERY', store, pickupSlot, value),
      );
    } catch (err) {
      setDeliverySlot('');
      showError(err);
    }
  };

  const submit = async () => {
    if (mode !== 'PICKUP' && !address) {
      await Taro.showToast({ title: '请先选择收货地址', icon: 'none' });
      void Taro.navigateTo({ url: '/pages/address/edit/index' });
      return;
    }
    if (mode !== 'EXPRESS' && !store) {
      await Taro.showToast({
        title: mode === 'PICKUP' ? '请选择自提门店' : '请选择配送门店',
        icon: 'none',
      });
      chooseStore(mode, mode === 'DELIVERY' ? address?.region : undefined);
      return;
    }
    if (mode === 'PICKUP' && !pickupSlot) {
      await Taro.showToast({ title: '请选择自提时段', icon: 'none' });
      return;
    }
    if (mode === 'DELIVERY' && !deliverySlot) {
      await Taro.showToast({ title: '请选择配送时段', icon: 'none' });
      return;
    }
    if (!preview || submitting) return;

    setSubmitting(true);
    try {
      if (mode === 'PICKUP') {
        await requestSubscriptions(['orderPaid', 'pickupReady']);
      } else if (mode === 'DELIVERY') {
        await requestSubscriptions(['orderPaid', 'deliveryAccepted', 'deliveryDone']);
      }
      const order = await api<CreatedOrder>('/orders', {
        method: 'POST',
        headers: {
          'Idempotency-Key': `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
        body: {
          ...buildBody(address, couponClaimId),
          ...(mode !== 'PICKUP' && address ? { addressId: address.id } : {}),
          ...(mode === 'PICKUP'
            ? { contactPhone: contactPhone.trim() || undefined }
            : {}),
          remark: remark.trim() || undefined,
        },
      });
      const outcome = await payOrder(order.id);
      await Taro.redirectTo({
        url: `/pages/pay-result/index?orderId=${order.id}&status=${outcome === 'paid' ? 'success' : 'pending'}`,
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
  const pickupSlotOptions = pickupSlots(store);
  const deliverySlotOptions = deliverySlots(store);
  const deliveryFeeText = store
    ? store.deliveryFeeCents > 0
      ? `配送费 ${money(store.deliveryFeeCents)}`
      : '免配送费'
    : '';

  return (
    <View className="page page--bar">
      <View className="card checkout-mode">
        <View
          className={`checkout-mode-item${mode === 'EXPRESS' ? ' checkout-mode-item--on' : ''}`}
          onClick={() => void switchMode('EXPRESS')}
        >
          快递
        </View>
        <View
          className={`checkout-mode-item${mode === 'PICKUP' ? ' checkout-mode-item--on' : ''}`}
          onClick={() => void switchMode('PICKUP')}
        >
          到店自提
        </View>
        <View
          className={`checkout-mode-item${mode === 'DELIVERY' ? ' checkout-mode-item--on' : ''}`}
          onClick={() => void switchMode('DELIVERY')}
        >
          同城配送
        </View>
      </View>

      {mode !== 'PICKUP' && (
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
      )}

      {mode !== 'EXPRESS' && (
        <>
          <View
            className="card checkout-address"
            onClick={() =>
              chooseStore(mode, mode === 'DELIVERY' ? address?.region : undefined)
            }
          >
            <View className="col grow">
              <Text className="checkout-receiver">
                {store
                  ? store.name
                  : mode === 'PICKUP'
                    ? '请选择自提门店'
                    : '请选择配送门店'}
              </Text>
              {store && (
                <Text className="small muted checkout-address-text">
                  {store.region} {store.address}
                </Text>
              )}
            </View>
            <Text className="muted tiny checkout-arrow">›</Text>
          </View>

          {store && mode === 'PICKUP' && (
            <View className="card">
              <Text className="section-title checkout-flush-title">自提时段</Text>
              <View className="checkout-slots">
                {pickupSlotOptions.map((slot) => (
                  <View
                    key={slot.label}
                    className={`checkout-slot${
                      pickupSlot === slot.value ? ' checkout-slot--on' : ''
                    }`}
                    onClick={() => void choosePickupSlot(slot.value)}
                  >
                    <Text className="small">{slot.label}</Text>
                  </View>
                ))}
                {!pickupSlotOptions.length && (
                  <Text className="muted small">今日已无可选自提时段</Text>
                )}
              </View>
              <View className="checkout-row">
                <Text className="small">联系电话</Text>
                <Input
                  className="checkout-phone-input"
                  type="number"
                  value={contactPhone}
                  placeholder="用于门店联系"
                  onInput={(e) => setContactPhone(e.detail.value)}
                />
              </View>
              {store.notice && <Text className="tiny muted">{store.notice}</Text>}
            </View>
          )}

          {store && mode === 'DELIVERY' && (
            <View className="card">
              <Text className="section-title checkout-flush-title">配送时段</Text>
              <View className="checkout-slots">
                {deliverySlotOptions.map((slot) => (
                  <View
                    key={slot}
                    className={`checkout-slot${
                      deliverySlot === slot ? ' checkout-slot--on' : ''
                    }`}
                    onClick={() => void chooseDeliverySlot(slot)}
                  >
                    <Text className="small">{slot}</Text>
                  </View>
                ))}
                {!deliverySlotOptions.length && (
                  <Text className="muted small">
                    {store.deliveryCutoff
                      ? `今日已截单（${store.deliveryCutoff}），请明日再约`
                      : '今日已无可用配送时段'}
                  </Text>
                )}
              </View>
              <View className="checkout-row">
                <Text className="small muted">
                  {deliveryFeeText}
                  {store.freeDeliveryThresholdCents > 0
                    ? ` · 满 ${money(store.freeDeliveryThresholdCents)} 免配送费`
                    : ''}
                </Text>
              </View>
              {store.notice && <Text className="tiny muted">{store.notice}</Text>}
            </View>
          )}
        </>
      )}

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
            {preview.member.cardName ?? preview.member.levelName} −
            {money(preview.amount.memberDiscountCents)}
          </Text>
        </View>
        {preview.fullReduction && (
          <View className="checkout-row">
            <Text className="small">满减</Text>
            <Text className="price small">
              {preview.fullReduction.name} −{money(preview.amount.fullReductionCents)}
            </Text>
          </View>
        )}
        <View className="checkout-row">
          <View className="col">
            <Text className="small">运费</Text>
            <Text className="muted tiny">
              {mode === 'PICKUP'
                ? '到店自提免运费'
                : mode === 'DELIVERY'
                  ? preview.amount.freightCents === 0
                    ? '同城配送免配送费'
                    : `同城配送费 ${money(preview.amount.freightCents)}`
                  : preview.member.freeShipping && !preview.freight.exceptionRegion
                    ? '会员卡包邮'
                    : preview.amount.freightCents === 0
                      ? `已满 ${money(preview.freight.freeThresholdCents)} 免运费`
                      : `满 ${money(preview.freight.freeThresholdCents)} 免运费`}
              {mode === 'EXPRESS' && preview.freight.exceptionRegion
                ? '；当前地区按例外运费计算'
                : ''}
            </Text>
          </View>
          <Text className="small">
            {preview.amount.freightCents === 0
              ? mode === 'DELIVERY'
                ? '免配送费'
                : '包邮'
              : money(preview.amount.freightCents)}
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
