import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, ApiError, formatDate, money } from '../api/client';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  Field,
  PageHeader,
  Tag,
  type Column,
} from '../components/ui';

interface ExpressCompany {
  id: string;
  code: string;
  name: string;
}

interface OrderRow {
  id: string;
  orderNo: string;
  payableCents: number;
  createdAt: string;
  customer: { nickname: string | null; phone: string | null };
  itemCount: number;
  firstItemTitle: string;
  address: { receiver?: string; phone?: string; region?: string; detail?: string };
}

interface OrderListResult {
  items: OrderRow[];
  total: number;
}

interface CsvItem {
  orderNo: string;
  trackingNo: string;
  expressCode?: string;
}

interface BatchResult {
  total: number;
  success: number;
  failed: number;
  results: Array<{
    orderId: string;
    orderNo: string;
    ok: boolean;
    trackingNo?: string;
    expressName?: string;
    reason?: string;
  }>;
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

function downloadCsv(filename: string, rows: string[][]): void {
  const content = rows
    .map((row) => row.map((cell) => `"${(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function BatchShip() {
  const [companies, setCompanies] = useState<ExpressCompany[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [expressCode, setExpressCode] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [csvText, setCsvText] = useState('');
  const [csvItems, setCsvItems] = useState<CsvItem[]>([]);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [companyResult, orderResult] = await Promise.all([
          api<{ items: ExpressCompany[] }>('/express-companies'),
          api<OrderListResult>('/admin/orders', {
            query: { status: 'PAID', page: 1, pageSize: 100 },
          }),
        ]);
        setCompanies(companyResult.items);
        setExpressCode(companyResult.items[0]?.code ?? '');
        setOrders(orderResult.items);
      } catch (err) {
        toast(errorText(err), 'error');
      } finally {
        setOrdersLoading(false);
      }
    })();
  }, []);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(orderId: string) {
    setSelected((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId],
    );
  }

  function toggleAll() {
    setSelected(selected.length === orders.length ? [] : orders.map((order) => order.id));
  }

  function parseCsv() {
    const lines = csvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      toast('请先粘贴或选择 CSV 内容', 'error');
      return;
    }

    const items: CsvItem[] = [];
    for (const line of lines) {
      const cells = line.split(/[,\t;]/).map((cell) => cell.trim().replace(/^"|"$/g, ''));
      const [orderNo, trackingNo, code] = cells;
      if (/^order/i.test(orderNo ?? '')) continue; // 跳过表头
      if (!orderNo || !trackingNo) continue;
      items.push({ orderNo, trackingNo, ...(code ? { expressCode: code } : {}) });
    }
    setCsvItems(items);
    toast(items.length ? `已解析 ${items.length} 条发货明细` : '未解析到有效明细', items.length ? 'success' : 'error');
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setCsvText(await file.text());
  }

  async function submit() {
    const items = csvItems.length
      ? csvItems
      : selected.map((orderId) => ({
          orderId,
          trackingNo: (tracking[orderId] ?? '').trim(),
        }));

    if (!items.length) {
      toast('请选择订单或导入 CSV', 'error');
      return;
    }
    if (!csvItems.length && items.some((item) => !('trackingNo' in item) || !item.trackingNo)) {
      toast('请为每个选中订单填写运单号', 'error');
      return;
    }
    if (!expressCode) {
      toast('请选择物流公司', 'error');
      return;
    }

    setSubmitting(true);
    setResult(null);
    try {
      const res = await api<BatchResult>('/admin/orders/batch-ship', {
        method: 'POST',
        body: { expressCode, items },
      });
      setResult(res);
      toast(`发货完成：成功 ${res.success} 单，失败 ${res.failed} 单`, res.failed ? 'error' : 'success');
      setSelected([]);
      setTracking({});
      setCsvItems([]);
      setCsvText('');

      const refreshed = await api<OrderListResult>('/admin/orders', {
        query: { status: 'PAID', page: 1, pageSize: 100 },
      });
      setOrders(refreshed.items);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const columns: Column<OrderRow>[] = [
    {
      key: 'select',
      title: (
        <input
          type="checkbox"
          aria-label="全选"
          checked={orders.length > 0 && selected.length === orders.length}
          onChange={toggleAll}
        />
      ),
      width: '48px',
      render: (row) => (
        <input
          type="checkbox"
          aria-label={`选择 ${row.orderNo}`}
          checked={selectedSet.has(row.id)}
          onChange={() => toggle(row.id)}
        />
      ),
    },
    { key: 'orderNo', title: '订单号', render: (row) => <span className="mono small">{row.orderNo}</span> },
    {
      key: 'customer',
      title: '客户 / 收货',
      render: (row) => (
        <div className="small">
          <div>{row.customer.nickname ?? '山野顾客'}</div>
          <div className="muted">
            {row.address?.receiver ?? '—'} {row.address?.phone ?? ''}
          </div>
          <div className="muted">
            {row.address?.region ?? ''} {row.address?.detail ?? ''}
          </div>
        </div>
      ),
    },
    {
      key: 'items',
      title: '商品',
      render: (row) => (
        <div>
          <div>{row.firstItemTitle || '—'}</div>
          <div className="small muted">共 {row.itemCount} 件</div>
        </div>
      ),
    },
    { key: 'payable', title: '实付', align: 'right', render: (row) => <span className="money">{money(row.payableCents)}</span> },
    { key: 'createdAt', title: '下单时间', render: (row) => <span className="small mono">{formatDate(row.createdAt)}</span> },
    {
      key: 'tracking',
      title: '运单号',
      render: (row) => (
        <input
          className="input"
          style={{ width: 180 }}
          placeholder="填写运单号"
          value={tracking[row.id] ?? ''}
          onChange={(e) => setTracking((prev) => ({ ...prev, [row.id]: e.target.value }))}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="批量发货"
        desc="勾选待发货订单并填写运单号，或导入 CSV；逐单返回成功与失败原因"
        actions={
          <Link className="btn btn-plain btn-sm" to="/orders">
            返回订单列表
          </Link>
        }
      />

      <Card title="发货设置">
        <div className="grid grid-2">
          <Field label="物流公司" hint="默认用于本次所有订单，CSV 可按行覆盖">
            <select className="input" value={expressCode} onChange={(e) => setExpressCode(e.target.value)}>
              <option value="">请选择物流公司</option>
              {companies.map((company) => (
                <option key={company.id} value={company.code}>
                  {company.name}（{company.code}）
                </option>
              ))}
            </select>
          </Field>
          <Field label="CSV 导入" hint="列顺序：订单号,运单号[,物流公司编码]；支持逗号 / 制表符">
            <div className="row" style={{ gap: 8 }}>
              <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void handleFile(e.target.files?.[0])} />
              <Button type="button" size="sm" variant="ghost" onClick={parseCsv}>
                解析 CSV
              </Button>
              {csvItems.length > 0 && <Tag tone="ok">已解析 {csvItems.length} 条</Tag>}
            </div>
          </Field>
        </div>
        <Field label="CSV 内容">
          <textarea
            className="textarea"
            rows={6}
            style={{ fontFamily: 'monospace' }}
            placeholder={'SN202611070001,SF1234567890,SF\nSN202611070002,7890123456,YTO'}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
          />
        </Field>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <span className="muted small grow">
            已选 {selected.length} 单{csvItems.length ? `，CSV ${csvItems.length} 条优先提交` : ''}
          </span>
          <Button loading={submitting} onClick={() => void submit()}>
            确认发货
          </Button>
        </div>
      </Card>

      <Card title={`待发货订单（${orders.length}）`} extra={<span className="small muted">最多展示 100 单</span>}>
        <DataTable columns={columns} rows={orders} loading={ordersLoading} empty="暂无待发货订单" />
      </Card>

      {result && (
        <Card
          title={`发货结果：成功 ${result.success} / ${result.total}`}
          extra={
            result.failed > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  downloadCsv(
                    `ship-failed-${Date.now()}.csv`,
                    [
                      ['订单号', '失败原因'],
                      ...result.results
                        .filter((item) => !item.ok)
                        .map((item) => [item.orderNo || item.orderId, item.reason ?? '未知原因']),
                    ],
                  )
                }
              >
                导出失败明细
              </Button>
            ) : null
          }
        >
          <DataTable
            columns={[
              { key: 'orderNo', title: '订单号', render: (row) => <span className="mono small">{row.orderNo || row.orderId}</span> },
              {
                key: 'ok',
                title: '结果',
                render: (row) => (
                  <Tag tone={row.ok ? 'ok' : 'danger'}>{row.ok ? '成功' : '失败'}</Tag>
                ),
              },
              {
                key: 'detail',
                title: '详情',
                render: (row) => (
                  <span className="small">
                    {row.ok ? `${row.expressName ?? ''} ${row.trackingNo ?? ''}` : row.reason ?? '—'}
                  </span>
                ),
              },
            ]}
            rows={result.results.map((item, index) => ({ id: `${item.orderId || item.orderNo}-${index}`, ...item }))}
            empty="暂无结果"
          />
        </Card>
      )}
    </>
  );
}
