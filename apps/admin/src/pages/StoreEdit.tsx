import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import pca from 'china-division/dist/pca-code.json';

import { api, ApiError, toCents, toYuan } from '../api/client';
import { assetPreviewUrl } from '../api/assets';
import { hasRole } from '../auth';
import { AssetPicker } from '../components/AssetPicker';
import { MapPicker } from '../components/MapPicker';
import { toast } from '../components/toast';
import { Button, Card, Field, PageHeader } from '../components/ui';

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

const DAYS: { key: DayKey; label: string }[] = [
  { key: 'mon', label: '周一' },
  { key: 'tue', label: '周二' },
  { key: 'wed', label: '周三' },
  { key: 'thu', label: '周四' },
  { key: 'fri', label: '周五' },
  { key: 'sat', label: '周六' },
  { key: 'sun', label: '周日' },
];

interface DayHours {
  enabled: boolean;
  open: string;
  close: string;
}

type HoursForm = Record<DayKey, DayHours>;

interface AreaNode {
  code: string;
  name: string;
  children?: AreaNode[];
}

const AREAS = pca as AreaNode[];

interface StoreDetail {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  logoKey: string | null;
  region: string;
  address: string;
  lat: number | null;
  lng: number | null;
  businessHours: Record<string, unknown>;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryFeeCents: number;
  freeDeliveryThresholdCents: number;
  deliverySlots: string[];
  deliveryCutoff: string | null;
  maxOrdersPerSlot: number;
  pickupCompleteDays: number;
  notice: string | null;
  status: 'ACTIVE' | 'DISABLED';
  sort: number;
  deliveryRegions: string[];
  managerUserId: string | null;
  manager: { id: string; nickname: string | null; phone: string | null } | null;
}

interface StoreFormState {
  code: string;
  name: string;
  phone: string;
  logoKey: string;
  address: string;
  lat: string;
  lng: string;
  sort: string;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  pickupCompleteDays: string;
  deliveryFeeYuan: string;
  freeThresholdYuan: string;
  deliverySlotsText: string;
  deliveryCutoff: string;
  maxOrdersPerSlot: string;
  deliveryRegionsText: string;
  notice: string;
  status: 'ACTIVE' | 'DISABLED';
  hours: HoursForm;
  managerUserId: string;
  managerName: string;
  managerPhone: string;
}

function defaultHours(): HoursForm {
  return {
    mon: { enabled: true, open: '09:00', close: '18:00' },
    tue: { enabled: true, open: '09:00', close: '18:00' },
    wed: { enabled: true, open: '09:00', close: '18:00' },
    thu: { enabled: true, open: '09:00', close: '18:00' },
    fri: { enabled: true, open: '09:00', close: '18:00' },
    sat: { enabled: true, open: '09:00', close: '18:00' },
    sun: { enabled: false, open: '09:00', close: '18:00' },
  };
}

function emptyForm(): StoreFormState {
  return {
    code: '',
    name: '',
    phone: '',
    logoKey: '',
    address: '',
    lat: '',
    lng: '',
    sort: '0',
    pickupEnabled: true,
    deliveryEnabled: false,
    pickupCompleteDays: '7',
    deliveryFeeYuan: '0',
    freeThresholdYuan: '0',
    deliverySlotsText: '',
    deliveryCutoff: '',
    maxOrdersPerSlot: '0',
    deliveryRegionsText: '',
    notice: '',
    status: 'ACTIVE',
    hours: defaultHours(),
    managerUserId: '',
    managerName: '',
    managerPhone: '',
  };
}

function parseHours(value: unknown): HoursForm {
  const hours = defaultHours();
  if (!value || typeof value !== 'object') return hours;
  for (const day of DAYS) {
    const ranges = (value as Record<string, unknown>)[day.key];
    if (!Array.isArray(ranges) || !Array.isArray(ranges[0])) continue;
    const [open, close] = ranges[0] as [unknown, unknown];
    if (typeof open === 'string' && typeof close === 'string') {
      hours[day.key] = { enabled: true, open, close };
    }
  }
  return hours;
}

function hoursPayload(hours: HoursForm): Record<string, string[][]> {
  const result: Record<string, string[][]> = {};
  for (const day of DAYS) {
    const value = hours[day.key];
    if (value.enabled && value.open && value.close) result[day.key] = [[value.open, value.close]];
  }
  return result;
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

/** 区域展示名：直辖市的「市辖区」不拼接 */
function areaText(province: AreaNode | null, city: AreaNode | null, district: AreaNode | null) {
  if (!province) return '';
  const cityPart = city && city.name !== '市辖区' && city.name !== '县' ? city.name : '';
  return `${province.name}${cityPart}${district?.name ?? ''}`;
}

function parseRegion(region: string): [AreaNode | null, AreaNode | null, AreaNode | null] {
  if (!region) return [null, null, null];
  for (const province of AREAS) {
    if (!region.startsWith(province.name)) continue;
    for (const city of province.children ?? []) {
      const cityPrefix = areaText(province, city, null);
      if (!region.startsWith(cityPrefix)) continue;
      for (const district of city.children ?? []) {
        if (region === `${cityPrefix}${district.name}`) return [province, city, district];
      }
      if (region === cityPrefix) return [province, city, null];
    }
    return [province, null, null];
  }
  return [null, null, null];
}

export default function StoreEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const editing = Boolean(id);
  const canWrite = hasRole('SUPER', 'OPS');
  const [form, setForm] = useState<StoreFormState>(emptyForm());
  const [province, setProvince] = useState<AreaNode | null>(null);
  const [city, setCity] = useState<AreaNode | null>(null);
  const [district, setDistrict] = useState<AreaNode | null>(null);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [managerKeyword, setManagerKeyword] = useState('');
  const [managerOptions, setManagerOptions] = useState<
    { id: string; nickname: string | null; phone: string | null }[]
  >([]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api<StoreDetail>(`/admin/stores/${id}`)
      .then((store) => {
        setForm({
          code: store.code,
          name: store.name,
          phone: store.phone ?? '',
          logoKey: store.logoKey ?? '',
          address: store.address,
          lat: store.lat === null ? '' : String(store.lat),
          lng: store.lng === null ? '' : String(store.lng),
          sort: String(store.sort),
          pickupEnabled: store.pickupEnabled,
          deliveryEnabled: store.deliveryEnabled,
          pickupCompleteDays: String(store.pickupCompleteDays),
          deliveryFeeYuan: toYuan(store.deliveryFeeCents),
          freeThresholdYuan: toYuan(store.freeDeliveryThresholdCents),
          deliverySlotsText: store.deliverySlots.join(', '),
          deliveryCutoff: store.deliveryCutoff ?? '',
          maxOrdersPerSlot: String(store.maxOrdersPerSlot),
          deliveryRegionsText: store.deliveryRegions.join('\n'),
          notice: store.notice ?? '',
          status: store.status,
          hours: parseHours(store.businessHours),
          managerUserId: store.managerUserId ?? '',
          managerName: store.manager?.nickname ?? '',
          managerPhone: store.manager?.phone ?? '',
        });
        const [p, c, d] = parseRegion(store.region);
        setProvince(p);
        setCity(c);
        setDistrict(d);
      })
      .catch((err) => {
        toast(errorText(err), 'error');
        navigate('/settings/stores');
      })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  function setField<K extends keyof StoreFormState>(key: K, value: StoreFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function searchManagers() {
    const keyword = managerKeyword.trim();
    if (!keyword) {
      setManagerOptions([]);
      return;
    }
    try {
      const result = await api<{
        items: { id: string; nickname: string | null; phone: string | null }[];
      }>('/admin/customers', { query: { keyword, pageSize: 10 } });
      setManagerOptions(result.items);
      if (!result.items.length) toast('没有匹配的会员', 'error');
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      toast('当前角色不可修改门店', 'error');
      return;
    }
    const region = areaText(province, city, district);
    if (!form.code.trim() || !form.name.trim() || !region || !form.address.trim()) {
      toast('请填写门店编码、名称、省市区与详细地址', 'error');
      return;
    }
    const slots = splitList(form.deliverySlotsText);
    if (slots.some((slot) => !/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(slot))) {
      toast('配送时段格式需为 10:00-12:00', 'error');
      return;
    }
    if (form.deliveryCutoff && !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.deliveryCutoff)) {
      toast('截单时间格式需为 HH:mm', 'error');
      return;
    }

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      logoKey: form.logoKey || '',
      region,
      address: form.address.trim(),
      ...(form.lat.trim() ? { lat: Number(form.lat) } : {}),
      ...(form.lng.trim() ? { lng: Number(form.lng) } : {}),
      sort: Number(form.sort) || 0,
      pickupEnabled: form.pickupEnabled,
      deliveryEnabled: form.deliveryEnabled,
      pickupCompleteDays: Number(form.pickupCompleteDays) || 7,
      deliveryFeeCents: toCents(form.deliveryFeeYuan),
      freeDeliveryThresholdCents: toCents(form.freeThresholdYuan),
      deliverySlots: slots,
      deliveryCutoff: form.deliveryCutoff || undefined,
      maxOrdersPerSlot: Number(form.maxOrdersPerSlot) || 0,
      deliveryRegions: splitList(form.deliveryRegionsText),
      notice: form.notice.trim() || undefined,
      status: form.status,
      businessHours: hoursPayload(form.hours),
      managerUserId: form.managerUserId || null,
    };

    setSaving(true);
    try {
      if (editing) await api(`/admin/stores/${id}`, { method: 'PATCH', body: payload });
      else await api('/admin/stores', { method: 'POST', body: payload });
      toast(editing ? '门店已保存' : '门店已创建');
      navigate('/settings/stores');
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      toast('当前浏览器不支持定位', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((prev) => ({
          ...prev,
          lat: position.coords.latitude.toFixed(6),
          lng: position.coords.longitude.toFixed(6),
        }));
        toast('已使用当前定位');
      },
      () => toast('定位失败，请在地图上手动选点', 'error'),
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader title={editing ? '编辑门店' : '新建门店'} />
        <div className="table-loading">加载中…</div>
      </>
    );
  }

  const cities = province?.children ?? [];
  const districts = city?.children ?? [];

  return (
    <>
      <PageHeader
        title={editing ? `编辑门店 · ${form.name || form.code}` : '新建门店'}
        desc="维护门店基础资料、地图位置、履约能力与营业时间"
        actions={
          <div className="row">
            <Button variant="ghost" onClick={() => navigate('/settings/stores')}>
              返回列表
            </Button>
            <Button type="submit" form="store-form" loading={saving} disabled={!canWrite}>
              保存门店
            </Button>
          </div>
        }
      />

      <form id="store-form" onSubmit={save} className="store-form">
        <Card title="基础资料">
          <div className="grid grid-2">
            <Field label="门店编码" required hint="2-20 位大写字母、数字、_、-">
              <input
                className="input"
                value={form.code}
                disabled={!canWrite}
                onChange={(event) => setField('code', event.target.value.toUpperCase())}
              />
            </Field>
            <Field label="门店名称" required>
              <input
                className="input"
                value={form.name}
                disabled={!canWrite}
                onChange={(event) => setField('name', event.target.value)}
              />
            </Field>
            <Field label="联系电话">
              <input
                className="input"
                value={form.phone}
                disabled={!canWrite}
                onChange={(event) => setField('phone', event.target.value)}
              />
            </Field>
            <Field label="排序" hint="数值越小越靠前">
              <input
                className="input"
                type="number"
                min={0}
                value={form.sort}
                disabled={!canWrite}
                onChange={(event) => setField('sort', event.target.value)}
              />
            </Field>
            <Field label="门店 Logo" hint="展示在小程序门店列表与门店中心">
              <AssetPicker
                value={form.logoKey}
                disabled={!canWrite}
                onChange={(key) => setField('logoKey', key)}
              />
            </Field>
            <Field label="门店状态">
              <select
                className="select"
                value={form.status}
                disabled={!canWrite}
                onChange={(event) =>
                  setField('status', event.target.value as 'ACTIVE' | 'DISABLED')
                }
              >
                <option value="ACTIVE">启用</option>
                <option value="DISABLED">停用</option>
              </select>
            </Field>
          </div>
          {form.logoKey && (
            <div className="store-logo-preview">
              <img src={assetPreviewUrl(form.logoKey)} alt="门店 Logo" />
              <span className="small muted">Logo 预览</span>
            </div>
          )}
        </Card>

        <Card title="门店位置">
          <div className="grid grid-2">
            <Field label="省 / 市 / 区" required wide>
              <div className="row" style={{ gap: 8 }}>
                <select
                  className="select"
                  aria-label="省份"
                  value={province?.code ?? ''}
                  disabled={!canWrite}
                  onChange={(event) => {
                    const next = AREAS.find((item) => item.code === event.target.value) ?? null;
                    setProvince(next);
                    setCity(null);
                    setDistrict(null);
                  }}
                >
                  <option value="">选择省份</option>
                  {AREAS.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select
                  className="select"
                  aria-label="城市"
                  value={city?.code ?? ''}
                  disabled={!canWrite || !province}
                  onChange={(event) => {
                    const next = cities.find((item) => item.code === event.target.value) ?? null;
                    setCity(next);
                    setDistrict(null);
                  }}
                >
                  <option value="">选择城市</option>
                  {cities.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select
                  className="select"
                  aria-label="区县"
                  value={district?.code ?? ''}
                  disabled={!canWrite || !city}
                  onChange={(event) => {
                    setDistrict(districts.find((item) => item.code === event.target.value) ?? null);
                  }}
                >
                  <option value="">选择区县</option>
                  {districts.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              {!province && editing && (
                <p className="small muted">原区域不在标准行政区划中，请重新选择省市区。</p>
              )}
            </Field>
            <Field label="详细地址" required wide hint="街道、门牌号">
              <input
                className="input"
                value={form.address}
                disabled={!canWrite}
                onChange={(event) => setField('address', event.target.value)}
              />
            </Field>
            <Field label="纬度">
              <input
                className="input"
                value={form.lat}
                disabled={!canWrite}
                onChange={(event) => setField('lat', event.target.value)}
              />
            </Field>
            <Field label="经度">
              <input
                className="input"
                value={form.lng}
                disabled={!canWrite}
                onChange={(event) => setField('lng', event.target.value)}
              />
            </Field>
          </div>
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <Button type="button" size="sm" variant="ghost" onClick={useCurrentLocation}>
              使用当前定位
            </Button>
            <span className="small muted">也可以在地图上点击选点，坐标会自动回填</span>
          </div>
          <MapPicker
            lat={form.lat.trim() ? Number(form.lat) : null}
            lng={form.lng.trim() ? Number(form.lng) : null}
            onChange={(lat, lng) =>
              setForm((prev) => ({ ...prev, lat: String(lat), lng: String(lng) }))
            }
          />
        </Card>

        <Card title="履约与营业">
          <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={form.pickupEnabled}
                disabled={!canWrite}
                onChange={(event) => setField('pickupEnabled', event.target.checked)}
              />
              <span className="small">开通到店自提</span>
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={form.deliveryEnabled}
                disabled={!canWrite}
                onChange={(event) => setField('deliveryEnabled', event.target.checked)}
              />
              <span className="small">开通同城配送</span>
            </label>
            <Field label="自提未取自动完成（天）">
              <input
                className="input"
                type="number"
                min={1}
                max={90}
                value={form.pickupCompleteDays}
                disabled={!canWrite}
                onChange={(event) => setField('pickupCompleteDays', event.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-2 store-hours">
            {DAYS.map((day) => (
              <div key={day.key} className="row" style={{ gap: 8 }}>
                <label className="row" style={{ gap: 6, width: 90 }}>
                  <input
                    type="checkbox"
                    checked={form.hours[day.key].enabled}
                    disabled={!canWrite}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        hours: {
                          ...prev.hours,
                          [day.key]: { ...prev.hours[day.key], enabled: event.target.checked },
                        },
                      }))
                    }
                  />
                  <span className="small">{day.label}</span>
                </label>
                <input
                  className="input"
                  type="time"
                  disabled={!canWrite || !form.hours[day.key].enabled}
                  value={form.hours[day.key].open}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      hours: {
                        ...prev.hours,
                        [day.key]: { ...prev.hours[day.key], open: event.target.value },
                      },
                    }))
                  }
                />
                <span className="muted">至</span>
                <input
                  className="input"
                  type="time"
                  disabled={!canWrite || !form.hours[day.key].enabled}
                  value={form.hours[day.key].close}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      hours: {
                        ...prev.hours,
                        [day.key]: { ...prev.hours[day.key], close: event.target.value },
                      },
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </Card>

        <Card title="同城配送规则">
          <div className="grid grid-3">
            <Field label="配送费（元）">
              <input
                className="input"
                value={form.deliveryFeeYuan}
                disabled={!canWrite}
                onChange={(event) => setField('deliveryFeeYuan', event.target.value)}
              />
            </Field>
            <Field label="免配送门槛（元）">
              <input
                className="input"
                value={form.freeThresholdYuan}
                disabled={!canWrite}
                onChange={(event) => setField('freeThresholdYuan', event.target.value)}
              />
            </Field>
            <Field label="每日截单时间" hint="HH:mm">
              <input
                className="input"
                type="time"
                value={form.deliveryCutoff}
                disabled={!canWrite}
                onChange={(event) => setField('deliveryCutoff', event.target.value)}
              />
            </Field>
            <Field label="每时段最大单量" hint="0 表示不限">
              <input
                className="input"
                type="number"
                min={0}
                value={form.maxOrdersPerSlot}
                disabled={!canWrite}
                onChange={(event) => setField('maxOrdersPerSlot', event.target.value)}
              />
            </Field>
          </div>
          <Field label="配送时段" hint="逗号分隔，例如 10:00-12:00, 14:00-18:00">
            <input
              className="input"
              value={form.deliverySlotsText}
              disabled={!canWrite}
              onChange={(event) => setField('deliverySlotsText', event.target.value)}
            />
          </Field>
          <Field label="配送区县" hint="每行一个，按收货地址区域匹配">
            <textarea
              className="textarea"
              rows={4}
              value={form.deliveryRegionsText}
              disabled={!canWrite}
              onChange={(event) => setField('deliveryRegionsText', event.target.value)}
            />
          </Field>
        </Card>

        <Card title="负责人与其他">
          <Field
            label="关联会员（门店负责人）"
            hint="该会员登录小程序后，个人中心会出现「门店中心」；需已绑定手机号"
          >
            {form.managerUserId ? (
              <div className="row" style={{ gap: 8 }}>
                <span className="small">
                  {form.managerName || form.managerUserId}
                  {form.managerPhone ? ` · ${form.managerPhone}` : ''}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!canWrite}
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      managerUserId: '',
                      managerName: '',
                      managerPhone: '',
                    }))
                  }
                >
                  更换
                </Button>
              </div>
            ) : (
              <>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="input"
                    style={{ width: 240 }}
                    aria-label="搜索关联会员"
                    placeholder="输入手机号 / 昵称搜索会员"
                    value={managerKeyword}
                    disabled={!canWrite}
                    onChange={(event) => setManagerKeyword(event.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={!canWrite}
                    onClick={() => void searchManagers()}
                  >
                    搜索
                  </Button>
                </div>
                {managerOptions.length > 0 && (
                  <div className="manager-options">
                    {managerOptions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="manager-option"
                        onClick={() => {
                          setForm((prev) => ({
                            ...prev,
                            managerUserId: item.id,
                            managerName: item.nickname ?? '山野顾客',
                            managerPhone: item.phone ?? '',
                          }));
                          setManagerOptions([]);
                          setManagerKeyword('');
                        }}
                      >
                        <span>{item.nickname ?? '山野顾客'}</span>
                        <span className="muted tiny">{item.phone ?? '未绑定手机号'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </Field>
          <Field label="门店公告">
            <textarea
              className="textarea"
              rows={3}
              value={form.notice}
              disabled={!canWrite}
              onChange={(event) => setField('notice', event.target.value)}
            />
          </Field>
        </Card>

        <div className="row-between">
          <span className="small muted">保存后立即生效</span>
          <div className="row" style={{ gap: 8 }}>
            <Button type="button" variant="plain" onClick={() => navigate('/settings/stores')}>
              取消
            </Button>
            <Button type="submit" loading={saving} disabled={!canWrite}>
              保存门店
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
