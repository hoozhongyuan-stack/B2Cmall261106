import { useEffect, useState, type FormEvent } from 'react';

import { api, ApiError, formatDate, money, toCents, toYuan } from '../api/client';
import { hasRole } from '../auth';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  Field,
  Modal,
  PageHeader,
  Stat,
  Tag,
  Toolbar,
  type Column,
} from '../components/ui';

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

interface StoreRow {
  id: string;
  code: string;
  name: string;
  phone: string | null;
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
  createdAt: string;
  updatedAt: string;
}

interface StoreFormState {
  code: string;
  name: string;
  phone: string;
  region: string;
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
}

interface StockRow {
  id?: string;
  skuId: string;
  code: string;
  title: string;
  specText: string;
  priceCents: number;
  stock: number;
  reserved: number;
  available: number;
  safetyStock: number;
  status: 'ON_SALE' | 'OFF_SHELF' | 'SOLD_OUT';
}

interface StockOption extends StockRow {
  configured: boolean;
}

interface StoreDashboard {
  store: { id: string; name: string; status: string };
  range: { start: string; end: string };
  today: {
    paidOrders: number;
    gmvCents: number;
    refundOrders: number;
    refundCents: number;
  };
  pending: { pickupOrders: number; deliveryOrders: number };
  delivery: {
    avgAcceptMinutes: number | null;
    avgDeliverMinutes: number | null;
    overdueCount: number;
  };
  stock: {
    warningCount: number;
    warnings: {
      skuId: string;
      code: string;
      title: string;
      available: number;
      safetyStock: number;
    }[];
  };
}

interface StockLog {
  id: string;
  skuId: string;
  skuCode: string;
  title: string;
  delta: number;
  beforeStock: number;
  afterStock: number;
  reason: string;
  orderId: string | null;
  operatorId: string | null;
  createdAt: string;
}

const REASON_LABEL: Record<string, string> = {
  ADJUST: '手工调整',
  ORDER_RESERVE: '下单预占',
  ORDER_RELEASE: '取消释放',
  ORDER_PAID: '支付扣减',
  REFUND: '退款回补',
  RESTOCK: '补货',
};

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
    region: '',
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
    if (value.enabled && value.open && value.close) {
      result[day.key] = [[value.open, value.close]];
    }
  }
  return result;
}

function formFromStore(store: StoreRow): StoreFormState {
  return {
    code: store.code,
    name: store.name,
    phone: store.phone ?? '',
    region: store.region,
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
  };
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

export default function Stores() {
  const canWrite = hasRole('SUPER', 'OPS');
  const canDisable = hasRole('SUPER');
  const [items, setItems] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StoreRow | null>(null);
  const [form, setForm] = useState<StoreFormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const [stockStore, setStockStore] = useState<StoreRow | null>(null);
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [stockTotal, setStockTotal] = useState(0);
  const [stockKeyword, setStockKeyword] = useState('');
  const [stockLoading, setStockLoading] = useState(false);
  const [stockEdits, setStockEdits] = useState<
    Record<string, { stock: string; safetyStock: string; status: string }>
  >({});
  const [savingStock, setSavingStock] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [options, setOptions] = useState<StockOption[]>([]);
  const [optionKeyword, setOptionKeyword] = useState('');

  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<StockLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const [dashboardStore, setDashboardStore] = useState<StoreRow | null>(null);
  const [dashboard, setDashboard] = useState<StoreDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await api<{ items: StoreRow[] }>('/admin/stores');
      setItems(result.items);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setFormOpen(true);
  }

  function openEdit(store: StoreRow) {
    setEditing(store);
    setForm(formFromStore(store));
    setFormOpen(true);
  }

  async function saveStore(event: FormEvent) {
    event.preventDefault();
    if (!form.code.trim() || !form.name.trim() || !form.region.trim() || !form.address.trim()) {
      toast('请填写门店编码、名称、区域与详细地址', 'error');
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
      region: form.region.trim(),
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
    };

    setSaving(true);
    try {
      if (editing) {
        await api(`/admin/stores/${editing.id}`, { method: 'PATCH', body: payload });
      } else {
        await api('/admin/stores', { method: 'POST', body: payload });
      }
      toast('已保存');
      setFormOpen(false);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(store: StoreRow) {
    try {
      if (store.status === 'ACTIVE') {
        if (!window.confirm(`确定停用门店「${store.name}」吗？历史订单会保留。`)) return;
        await api(`/admin/stores/${store.id}`, { method: 'DELETE' });
      } else {
        await api(`/admin/stores/${store.id}`, {
          method: 'PATCH',
          body: { status: 'ACTIVE' },
        });
      }
      toast('已更新');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function loadStock(storeId: string, keyword = '') {
    setStockLoading(true);
    try {
      const result = await api<{ items: StockRow[]; total: number }>(
        `/admin/stores/${storeId}/skus`,
        { query: { keyword, page: 1, pageSize: 50 } },
      );
      setStockRows(result.items);
      setStockTotal(result.total);
      setStockEdits(
        Object.fromEntries(
          result.items.map((item) => [
            item.skuId,
            {
              stock: String(item.stock),
              safetyStock: String(item.safetyStock),
              status: item.status,
            },
          ]),
        ),
      );
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setStockLoading(false);
    }
  }

  function openStock(store: StoreRow) {
    setStockStore(store);
    setStockKeyword('');
    void loadStock(store.id);
  }

  async function saveStock() {
    if (!stockStore) return;
    const invalid = stockRows.some((row) => {
      const edit = stockEdits[row.skuId];
      if (!edit) return false;
      const stock = Number(edit.stock);
      const safetyStock = Number(edit.safetyStock);
      return (
        !Number.isInteger(stock) ||
        stock < 0 ||
        !Number.isInteger(safetyStock) ||
        safetyStock < 0
      );
    });
    if (invalid) {
      toast('库存与安全库存必须为非负整数', 'error');
      return;
    }

    const changed = stockRows.flatMap((row) => {
      const edit = stockEdits[row.skuId];
      if (!edit) return [];
      const stock = Number(edit.stock);
      const safetyStock = Number(edit.safetyStock);
      if (
        stock === row.stock &&
        safetyStock === row.safetyStock &&
        edit.status === row.status
      ) {
        return [];
      }
      return [{ skuId: row.skuId, stock, safetyStock, status: edit.status }];
    });
    if (!changed.length) {
      toast('没有需要保存的修改');
      return;
    }

    setSavingStock(true);
    try {
      await api(`/admin/stores/${stockStore.id}/skus/batch`, {
        method: 'POST',
        body: { items: changed },
      });
      toast(`已保存 ${changed.length} 个 SKU`);
      await loadStock(stockStore.id, stockKeyword);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSavingStock(false);
    }
  }

  async function loadOptions(keyword = '') {
    if (!stockStore) return;
    try {
      const result = await api<{ items: StockOption[] }>(
        `/admin/stores/${stockStore.id}/sku-options`,
        { query: { keyword, page: 1, pageSize: 30 } },
      );
      setOptions(result.items.filter((item) => !item.configured));
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  function openAdd() {
    setAddOpen(true);
    setOptionKeyword('');
    void loadOptions();
  }

  async function addSku(option: StockOption) {
    if (!stockStore) return;
    try {
      await api(`/admin/stores/${stockStore.id}/skus/${option.skuId}`, {
        method: 'PATCH',
        body: { stock: 0 },
      });
      toast('已添加到门店，请设置库存');
      setAddOpen(false);
      await loadStock(stockStore.id, stockKeyword);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function openDashboard(store: StoreRow) {
    setDashboardStore(store);
    setDashboard(null);
    setDashboardLoading(true);
    try {
      setDashboard(await api<StoreDashboard>(`/admin/stores/${store.id}/dashboard`));
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setDashboardLoading(false);
    }
  }

  async function openLogs() {
    if (!stockStore) return;
    setLogsOpen(true);
    setLogsLoading(true);
    try {
      const result = await api<{ items: StockLog[] }>(
        `/admin/stores/${stockStore.id}/stock-logs`,
        { query: { page: 1, pageSize: 50 } },
      );
      setLogs(result.items);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLogsLoading(false);
    }
  }

  const columns: Column<StoreRow>[] = [
    {
      key: 'name',
      title: '门店',
      render: (row) => (
        <div>
          <div>{row.name}</div>
          <div className="small muted mono">{row.code}</div>
        </div>
      ),
    },
    {
      key: 'region',
      title: '区域 / 地址',
      render: (row) => (
        <div className="small">
          <div>{row.region}</div>
          <div className="muted">{row.address}</div>
        </div>
      ),
    },
    {
      key: 'fulfillment',
      title: '履约能力',
      render: (row) => (
        <div className="row" style={{ gap: 6 }}>
          {row.pickupEnabled && <Tag tone="brand">自提</Tag>}
          {row.deliveryEnabled && <Tag tone="ok">配送</Tag>}
          {!row.pickupEnabled && !row.deliveryEnabled && <Tag>未开通</Tag>}
        </div>
      ),
    },
    {
      key: 'delivery',
      title: '配送规则',
      render: (row) => (
        <div className="small">
          <div>配送费 {toYuan(row.deliveryFeeCents)} 元</div>
          <div className="muted">
            满 {toYuan(row.freeDeliveryThresholdCents)} 元免配送费
            {row.deliveryCutoff ? ` · ${row.deliveryCutoff} 截单` : ''}
          </div>
          <div className="muted">{row.deliverySlots.join('、') || '未设置时段'}</div>
        </div>
      ),
    },
    {
      key: 'pickup',
      title: '自提',
      render: (row) => (
        <span className="small">
          {row.pickupEnabled ? `${row.pickupCompleteDays} 天未取自动完成` : '未开通'}
        </span>
      ),
    },
    {
      key: 'status',
      title: '状态',
      render: (row) => (
        <Tag tone={row.status === 'ACTIVE' ? 'ok' : 'muted'}>
          {row.status === 'ACTIVE' ? '启用' : '停用'}
        </Tag>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      align: 'right',
      render: (row) => (
        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={() => void openDashboard(row)}>
            看板
          </Button>
          {canWrite && (
            <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
              编辑
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => openStock(row)}>
            库存
          </Button>
          {(canWrite || canDisable) && (
            <Button size="sm" variant="plain" onClick={() => void toggleStatus(row)}>
              {row.status === 'ACTIVE' ? '停用' : '启用'}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const stockColumns: Column<StockRow>[] = [
    {
      key: 'sku',
      title: '商品 / SKU',
      render: (row) => (
        <div>
          <div>{row.title}</div>
          <div className="small muted">
            {row.specText} · {row.code}
          </div>
        </div>
      ),
    },
    {
      key: 'stock',
      title: '库存',
      render: (row) => (
        <input
          className="input"
          style={{ width: 90 }}
          type="number"
          min={0}
          aria-label={`${row.title} 库存`}
          value={stockEdits[row.skuId]?.stock ?? String(row.stock)}
          onChange={(e) =>
            setStockEdits((prev) => ({
              ...prev,
              [row.skuId]: { ...prev[row.skuId], stock: e.target.value },
            }))
          }
        />
      ),
    },
    {
      key: 'reserved',
      title: '已预占',
      align: 'right',
      render: (row) => <span className="mono">{row.reserved}</span>,
    },
    {
      key: 'available',
      title: '可售',
      align: 'right',
      render: (row) => <span className="mono">{row.available}</span>,
    },
    {
      key: 'safetyStock',
      title: '安全库存',
      render: (row) => (
        <input
          className="input"
          style={{ width: 90 }}
          type="number"
          min={0}
          aria-label={`${row.title} 安全库存`}
          value={stockEdits[row.skuId]?.safetyStock ?? String(row.safetyStock)}
          onChange={(e) =>
            setStockEdits((prev) => ({
              ...prev,
              [row.skuId]: { ...prev[row.skuId], safetyStock: e.target.value },
            }))
          }
        />
      ),
    },
    {
      key: 'status',
      title: '状态',
      render: (row) => (
        <select
          className="select"
          value={stockEdits[row.skuId]?.status ?? row.status}
          onChange={(e) =>
            setStockEdits((prev) => ({
              ...prev,
              [row.skuId]: { ...prev[row.skuId], status: e.target.value },
            }))
          }
        >
          <option value="ON_SALE">在售</option>
          <option value="OFF_SHELF">停售</option>
        </select>
      ),
    },
  ];

  const logColumns: Column<StockLog>[] = [
    {
      key: 'createdAt',
      title: '时间',
      render: (row) => <span className="small mono">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'sku',
      title: '商品',
      render: (row) => (
        <div>
          <div>{row.title || '—'}</div>
          <div className="small muted mono">{row.skuCode}</div>
        </div>
      ),
    },
    {
      key: 'reason',
      title: '类型',
      render: (row) => <Tag>{REASON_LABEL[row.reason] ?? row.reason}</Tag>,
    },
    {
      key: 'delta',
      title: '变化',
      align: 'right',
      render: (row) => (
        <span className="mono">
          {row.delta > 0 ? '+' : ''}
          {row.delta}
        </span>
      ),
    },
    {
      key: 'stock',
      title: '可售变化',
      align: 'right',
      render: (row) => (
        <span className="small mono">
          {row.beforeStock} → {row.afterStock}
        </span>
      ),
    },
    {
      key: 'orderId',
      title: '关联订单',
      render: (row) => <span className="small mono">{row.orderId ?? '—'}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="门店管理"
        desc="配置门店、履约能力、配送规则与门店库存；停用后不影响历史订单"
        actions={canWrite ? <Button onClick={openCreate}>新建门店</Button> : undefined}
      />

      <Card>
        <DataTable columns={columns} rows={items} loading={loading} empty="还没有门店" />
      </Card>

      <Modal
        open={formOpen}
        wide
        title={editing ? `编辑门店 · ${editing.name}` : '新建门店'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="plain" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button type="submit" form="store-form" loading={saving}>
              保存
            </Button>
          </>
        }
      >
        <form
          id="store-form"
          onSubmit={saveStore}
          style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <div className="grid grid-3">
            <Field label="门店编码" hint="2-20 位大写字母、数字、_、-">
              <input
                className="input"
                value={form.code}
                onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
              />
            </Field>
            <Field label="门店名称">
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </Field>
            <Field label="联系电话">
              <input
                className="input"
                value={form.phone}
                onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
              />
            </Field>
            <Field label="所在区域">
              <input
                className="input"
                value={form.region}
                placeholder="云南省昆明市五华区"
                onChange={(e) => setForm((prev) => ({ ...prev, region: e.target.value }))}
              />
            </Field>
            <Field label="详细地址" wide>
              <input
                className="input"
                value={form.address}
                onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
              />
            </Field>
            <Field label="纬度" hint="选填，仅展示">
              <input
                className="input"
                value={form.lat}
                onChange={(e) => setForm((prev) => ({ ...prev, lat: e.target.value }))}
              />
            </Field>
            <Field label="经度" hint="选填，仅展示">
              <input
                className="input"
                value={form.lng}
                onChange={(e) => setForm((prev) => ({ ...prev, lng: e.target.value }))}
              />
            </Field>
            <Field label="排序">
              <input
                className="input"
                type="number"
                min={0}
                value={form.sort}
                onChange={(e) => setForm((prev) => ({ ...prev, sort: e.target.value }))}
              />
            </Field>
          </div>

          <div className="row" style={{ gap: 20 }}>
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={form.pickupEnabled}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, pickupEnabled: e.target.checked }))
                }
              />
              <span className="small">开通到店自提</span>
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={form.deliveryEnabled}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, deliveryEnabled: e.target.checked }))
                }
              />
              <span className="small">开通同城配送</span>
            </label>
            <Field label="自提未取自动完成天数">
              <input
                className="input"
                type="number"
                min={1}
                max={90}
                value={form.pickupCompleteDays}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, pickupCompleteDays: e.target.value }))
                }
              />
            </Field>
            <Field label="门店状态">
              <select
                className="select"
                value={form.status}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, status: e.target.value as 'ACTIVE' | 'DISABLED' }))
                }
              >
                <option value="ACTIVE">启用</option>
                <option value="DISABLED">停用</option>
              </select>
            </Field>
          </div>

          <Card title="营业时间">
            <div className="grid grid-2">
              {DAYS.map((day) => (
                <div key={day.key} className="row" style={{ gap: 8 }}>
                  <label className="row" style={{ gap: 6, width: 90 }}>
                    <input
                      type="checkbox"
                      checked={form.hours[day.key].enabled}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          hours: {
                            ...prev.hours,
                            [day.key]: { ...prev.hours[day.key], enabled: e.target.checked },
                          },
                        }))
                      }
                    />
                    <span className="small">{day.label}</span>
                  </label>
                  <input
                    className="input"
                    type="time"
                    disabled={!form.hours[day.key].enabled}
                    value={form.hours[day.key].open}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        hours: {
                          ...prev.hours,
                          [day.key]: { ...prev.hours[day.key], open: e.target.value },
                        },
                      }))
                    }
                  />
                  <span className="muted">至</span>
                  <input
                    className="input"
                    type="time"
                    disabled={!form.hours[day.key].enabled}
                    value={form.hours[day.key].close}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        hours: {
                          ...prev.hours,
                          [day.key]: { ...prev.hours[day.key], close: e.target.value },
                        },
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card title="同城配送">
            <div className="grid grid-3">
              <Field label="配送费（元）">
                <input
                  className="input"
                  value={form.deliveryFeeYuan}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, deliveryFeeYuan: e.target.value }))
                  }
                />
              </Field>
              <Field label="免配送门槛（元）">
                <input
                  className="input"
                  value={form.freeThresholdYuan}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, freeThresholdYuan: e.target.value }))
                  }
                />
              </Field>
              <Field label="每日截单时间" hint="HH:mm">
                <input
                  className="input"
                  type="time"
                  value={form.deliveryCutoff}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, deliveryCutoff: e.target.value }))
                  }
                />
              </Field>
              <Field label="每时段最大单量" hint="0 表示不限">
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={form.maxOrdersPerSlot}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, maxOrdersPerSlot: e.target.value }))
                  }
                />
              </Field>
            </div>
            <Field label="配送时段" hint="逗号分隔，例如 10:00-12:00, 14:00-18:00">
              <input
                className="input"
                value={form.deliverySlotsText}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, deliverySlotsText: e.target.value }))
                }
              />
            </Field>
            <Field label="配送区县" hint="每行一个，按收货地址区域匹配">
              <textarea
                className="textarea"
                rows={4}
                value={form.deliveryRegionsText}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, deliveryRegionsText: e.target.value }))
                }
              />
            </Field>
          </Card>

          <Field label="门店公告">
            <textarea
              className="textarea"
              rows={3}
              value={form.notice}
              onChange={(e) => setForm((prev) => ({ ...prev, notice: e.target.value }))}
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(dashboardStore)}
        wide
        title={`门店看板${dashboardStore ? ` · ${dashboardStore.name}` : ''}`}
        onClose={() => setDashboardStore(null)}
        footer={
          <Button variant="plain" onClick={() => setDashboardStore(null)}>
            关闭
          </Button>
        }
      >
        {dashboardLoading && <div className="table-loading">加载中…</div>}
        {!dashboardLoading && dashboard && (
          <>
            <div className="grid grid-3">
              <Stat label="今日支付订单" value={dashboard.today.paidOrders} />
              <Stat
                label="今日营业额"
                value={money(dashboard.today.gmvCents)}
                tone="brand"
              />
              <Stat
                label="今日退款"
                value={money(dashboard.today.refundCents)}
                hint={`${dashboard.today.refundOrders} 笔`}
                tone="warn"
              />
              <Stat label="待自提" value={dashboard.pending.pickupOrders} />
              <Stat label="待配送" value={dashboard.pending.deliveryOrders} />
              <Stat
                label="平均接单时长"
                value={
                  dashboard.delivery.avgAcceptMinutes === null
                    ? '—'
                    : `${dashboard.delivery.avgAcceptMinutes} 分钟`
                }
                hint="今日已接单配送单"
              />
              <Stat
                label="平均送达时长"
                value={
                  dashboard.delivery.avgDeliverMinutes === null
                    ? '—'
                    : `${dashboard.delivery.avgDeliverMinutes} 分钟`
                }
                hint="接单到送达"
              />
              <Stat
                label="超时配送单"
                value={dashboard.delivery.overdueCount}
                tone={dashboard.delivery.overdueCount > 0 ? 'warn' : 'ok'}
                hint="待接单超 15 分钟 / 配送中超 60 分钟"
              />
              <Stat
                label="库存预警"
                value={dashboard.stock.warningCount}
                tone={dashboard.stock.warningCount > 0 ? 'warn' : 'ok'}
              />
            </div>
            <Card title="库存预警">
              {!dashboard.stock.warnings.length ? (
                <div className="empty">暂无库存预警</div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>商品 / SKU</th>
                        <th style={{ textAlign: 'right' }}>可售</th>
                        <th style={{ textAlign: 'right' }}>安全库存</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.stock.warnings.map((warning) => (
                        <tr key={warning.skuId}>
                          <td>
                            <div>{warning.title}</div>
                            <div className="small muted mono">{warning.code}</div>
                          </td>
                          <td style={{ textAlign: 'right' }} className="mono">
                            {warning.available}
                          </td>
                          <td style={{ textAlign: 'right' }} className="mono">
                            {warning.safetyStock}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </Modal>

      <Modal
        open={Boolean(stockStore)}
        wide
        title={`门店库存${stockStore ? ` · ${stockStore.name}` : ''}`}
        onClose={() => setStockStore(null)}
        footer={
          <>
            <Button variant="plain" onClick={() => setStockStore(null)}>
              关闭
            </Button>
            <Button loading={savingStock} onClick={() => void saveStock()}>
              保存修改
            </Button>
          </>
        }
      >
        <Toolbar>
          <input
            className="input"
            style={{ width: 240 }}
            placeholder="搜索 SKU 编码 / 商品名"
            value={stockKeyword}
            onChange={(e) => setStockKeyword(e.target.value)}
          />
          <Button
            variant="ghost"
            onClick={() => stockStore && void loadStock(stockStore.id, stockKeyword)}
          >
            搜索
          </Button>
          <Button variant="plain" onClick={openAdd}>
            添加商品
          </Button>
          <Button variant="plain" onClick={() => void openLogs()}>
            库存流水
          </Button>
          <span className="small muted">共 {stockTotal} 个 SKU</span>
        </Toolbar>
        <DataTable
          columns={stockColumns}
          rows={stockRows}
          loading={stockLoading}
          empty="该门店还没有配置库存，点击「添加商品」"
          rowKey={(row) => row.skuId}
        />
      </Modal>

      <Modal
        open={addOpen}
        wide
        title="添加商品到门店"
        onClose={() => setAddOpen(false)}
        footer={
          <Button variant="plain" onClick={() => setAddOpen(false)}>
            关闭
          </Button>
        }
      >
        <Toolbar>
          <input
            className="input"
            style={{ width: 240 }}
            placeholder="搜索 SKU 编码 / 商品名"
            value={optionKeyword}
            onChange={(e) => setOptionKeyword(e.target.value)}
          />
          <Button variant="ghost" onClick={() => void loadOptions(optionKeyword)}>
            搜索
          </Button>
        </Toolbar>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>商品 / SKU</th>
                <th>售价</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {options.map((option) => (
                <tr key={option.skuId}>
                  <td>
                    <div>{option.title}</div>
                    <div className="small muted">
                      {option.specText} · {option.code}
                    </div>
                  </td>
                  <td className="mono">{toYuan(option.priceCents)} 元</td>
                  <td style={{ textAlign: 'right' }}>
                    <Button size="sm" variant="ghost" onClick={() => void addSku(option)}>
                      添加
                    </Button>
                  </td>
                </tr>
              ))}
              {!options.length && (
                <tr>
                  <td colSpan={3} className="muted small">
                    没有可添加的商品
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Modal>

      <Modal
        open={logsOpen}
        wide
        title="门店库存流水"
        onClose={() => setLogsOpen(false)}
        footer={
          <Button variant="plain" onClick={() => setLogsOpen(false)}>
            关闭
          </Button>
        }
      >
        <DataTable
          columns={logColumns}
          rows={logs}
          loading={logsLoading}
          empty="暂无库存流水"
        />
      </Modal>
    </>
  );
}
