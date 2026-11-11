import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError, formatDate, money, toYuan } from '../api/client';
import { assetPreviewUrl } from '../api/assets';
import { hasRole } from '../auth';
import { toast } from '../components/toast';
import {
  BulkBar,
  Button,
  Card,
  Confirm,
  DataTable,
  Modal,
  PageHeader,
  Pagination,
  RowActions,
  Stat,
  Tag,
  Toolbar,
  type Column,
} from '../components/ui';

interface StoreRow {
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
  temporarilyClosedUntil: string | null;
  temporaryClosureNote: string | null;
  temporarilyClosed: boolean;
  managerUserId: string | null;
  manager: { id: string; nickname: string | null; phone: string | null } | null;
  createdAt: string;
  updatedAt: string;
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

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function Stores() {
  const navigate = useNavigate();
  const canWrite = hasRole('SUPER', 'OPS');
  const canDisable = hasRole('SUPER');
  const [items, setItems] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [disabling, setDisabling] = useState<StoreRow | null>(null);

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

  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [capability, setCapability] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [batching, setBatching] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await api<{ total: number; items: StoreRow[] }>('/admin/stores', {
        query: {
          keyword: appliedKeyword || undefined,
          status: statusFilter || undefined,
          capability: capability || undefined,
          page,
          pageSize,
        },
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [appliedKeyword, statusFilter, capability, page, pageSize]);

  useEffect(() => {
    setSelected([]);
  }, [appliedKeyword, statusFilter, capability, page]);

  async function batchStatus(status: 'ACTIVE' | 'DISABLED') {
    setBatching(true);
    try {
      const result = await api<{ success: number; failed: number }>('/admin/stores/batch/status', {
        method: 'POST',
        body: { ids: selected, status },
      });
      toast(
        `已${status === 'ACTIVE' ? '启用' : '停用'} ${result.success} 个门店${
          result.failed ? `，${result.failed} 个失败` : ''
        }`,
        result.failed ? 'error' : 'success',
      );
      setSelected([]);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBatching(false);
    }
  }

  function openCreate() {
    navigate('/settings/stores/new');
  }

  function openEdit(store: StoreRow) {
    navigate(`/settings/stores/${store.id}/edit`);
  }

  async function toggleStatus(store: StoreRow) {
    if (store.status === 'ACTIVE') {
      setDisabling(store);
      return;
    }
    try {
      await api(`/admin/stores/${store.id}`, { method: 'PATCH', body: { status: 'ACTIVE' } });
      toast('已更新');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function disableStore(store: StoreRow) {
    try {
      await api(`/admin/stores/${store.id}`, { method: 'DELETE' });
      toast('已停用');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setDisabling(null);
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
      minWidth: 190,
      render: (row) => {
        const logo =
          row.logoKey && /^(?:https?:\/\/|\/api\/)/i.test(row.logoKey)
            ? assetPreviewUrl(row.logoKey)
            : '';
        return (
          <div className="cell-product">
            {logo ? (
              <img className="cell-thumb" src={logo} alt="" loading="lazy" />
            ) : (
              <span className="cell-thumb cell-thumb--empty" aria-hidden="true">
                {row.name.slice(0, 1)}
              </span>
            )}
            <div className="cell-product-text">
              <div className="cell-title cell-clip" title={row.name}>
                {row.name}
              </div>
              <div className="small muted mono">{row.code}</div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'region',
      title: '区域 / 地址',
      minWidth: 190,
      render: (row) => (
        <div className="small">
          <div className="cell-clip" title={row.region}>
            {row.region}
          </div>
          <div className="muted cell-clip" title={row.address}>
            {row.address}
          </div>
        </div>
      ),
    },
    {
      key: 'manager',
      title: '负责人',
      minWidth: 150,
      render: (row) =>
        row.manager ? (
          <div className="small">
            <div className="cell-clip">{row.manager.nickname ?? '山野顾客'}</div>
            <div className="muted cell-clip">{row.manager.phone ?? '—'}</div>
          </div>
        ) : (
          <span className="small muted">未关联</span>
        ),
    },
    {
      key: 'fulfillment',
      title: '履约',
      minWidth: 140,
      render: (row) => (
        <div className="row" style={{ gap: 6 }}>
          {row.pickupEnabled && <Tag tone="brand">自提</Tag>}
          {row.deliveryEnabled && <Tag tone="ok">配送</Tag>}
          <Tag tone={row.status === 'ACTIVE' ? 'ok' : 'muted'}>
            {row.status === 'ACTIVE' ? '启用' : '停用'}
          </Tag>
          {row.temporarilyClosed && <Tag tone="muted">临时打烊</Tag>}
          {!row.pickupEnabled && !row.deliveryEnabled && <Tag>未开通</Tag>}
        </div>
      ),
    },
    {
      key: 'delivery',
      title: '配送规则',
      minWidth: 230,
      render: (row) => {
        const summary = row.deliveryEnabled
          ? `¥${toYuan(row.deliveryFeeCents)} · 满 ¥${toYuan(row.freeDeliveryThresholdCents)} 免`
          : '未开通配送';
        const detail = row.deliveryEnabled
          ? `${row.deliveryCutoff ? `${row.deliveryCutoff} 截单 · ` : ''}${
              row.deliverySlots.join('、') || '未设置时段'
            }`
          : '';
        return (
          <div className="small">
            <div className="cell-clip" title={summary}>
              {summary}
            </div>
            <div className="muted cell-clip" title={detail}>
              {detail || '—'}
            </div>
          </div>
        );
      },
    },
    {
      key: 'pickup',
      title: '自提时效',
      minWidth: 90,
      render: (row) => (
        <span className="small" title={row.pickupEnabled ? `${row.pickupCompleteDays} 天未取自动完成` : ''}>
          {row.pickupEnabled ? `${row.pickupCompleteDays} 天` : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      align: 'right',
      minWidth: 128,
      render: (row) => (
        <RowActions
          primary={{ label: '看板', onClick: () => void openDashboard(row) }}
          actions={[
            { label: '编辑', onClick: () => openEdit(row), hidden: !canWrite },
            { label: '库存', onClick: () => openStock(row) },
            {
              label: row.status === 'ACTIVE' ? '停用' : '启用',
              onClick: () => void toggleStatus(row),
              hidden: !(canWrite || canDisable),
            },
          ]}
        />
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
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedKeyword(keyword.trim());
            setPage(1);
          }}
        >
          <Toolbar>
            <input
              className="input"
              style={{ width: 240 }}
              aria-label="搜索门店名称或编码"
              placeholder="搜索门店名称 / 编码 / 区域…"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <select
              className="select"
              aria-label="门店状态"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部状态</option>
              <option value="ACTIVE">启用</option>
              <option value="DISABLED">停用</option>
            </select>
            <select
              className="select"
              aria-label="履约能力"
              value={capability}
              onChange={(event) => {
                setCapability(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部履约能力</option>
              <option value="PICKUP">支持自提</option>
              <option value="DELIVERY">支持配送</option>
            </select>
            <div className="toolbar-actions">
              <Button
                type="button"
                variant="plain"
                onClick={() => {
                  setKeyword('');
                  setAppliedKeyword('');
                  setStatusFilter('');
                  setCapability('');
                  setPage(1);
                }}
              >
                重置
              </Button>
              <Button type="submit" variant="ghost">
                搜索
              </Button>
            </div>
          </Toolbar>
        </form>
        <DataTable
          columns={columns}
          rows={items}
          loading={loading}
          empty="还没有门店"
          selection={canDisable ? { selected, onChange: setSelected } : undefined}
        />
        <Pagination
          page={page}
          total={total}
          pageSize={pageSize}
          onChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </Card>

      <BulkBar
        count={selected.length}
        onClear={() => setSelected([])}
        actions={[
          { label: '批量启用', onClick: () => void batchStatus('ACTIVE'), disabled: batching },
          { label: '批量停用', onClick: () => void batchStatus('DISABLED'), disabled: batching },
        ]}
      />

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
      <Confirm
        open={Boolean(disabling)}
        title="停用门店"
        danger
        confirmText="停用"
        text={`确定停用门店「${disabling?.name ?? ''}」吗？历史订单会保留。`}
        onCancel={() => setDisabling(null)}
        onConfirm={() => {
          if (disabling) void disableStore(disabling);
        }}
      />
    </>
  );
}
