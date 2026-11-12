import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { api, ApiError, toCents, toYuan } from '../api/client';
import { can } from '../auth';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  Tag,
  type Column,
} from '../components/ui';

interface SkuData {
  id: string;
  code: string;
  specJson: Record<string, string>;
  priceCents: number;
  pointsCost: number | null;
  pointsMoneyCents: number;
  stock: number;
  status: string;
}

interface ProductData {
  id: string;
  title: string;
  channel: 'NORMAL' | 'POINTS';
  priceMinCents: number;
  priceMaxCents: number;
  skus: SkuData[];
}

interface EditableSku extends SkuData {
  priceYuan: string;
  pointsCostText: string;
  pointsMoneyYuan: string;
  stockText: string;
}

const SKU_STATUSES = [
  { value: 'ON_SALE', label: '在售' },
  { value: 'OFF_SHELF', label: '下架' },
  { value: 'SOLD_OUT', label: '售罄' },
];

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function ProductStock() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canWrite = can('product.stock');
  const [product, setProduct] = useState<ProductData | null>(null);
  const [rows, setRows] = useState<EditableSku[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [savingId, setSavingId] = useState('');

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const result = await api<ProductData>(`/admin/products/${id}`);
      setProduct(result);
      setRows(
        result.skus.map((sku) => ({
          ...sku,
          priceYuan: toYuan(sku.priceCents),
          pointsCostText: sku.pointsCost ? String(sku.pointsCost) : '',
          pointsMoneyYuan: toYuan(sku.pointsMoneyCents),
          stockText: String(sku.stock),
        })),
      );
    } catch (err) {
      setNotFound(true);
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  function updateRow(index: number, patch: Partial<EditableSku>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function saveRow(row: EditableSku) {
    if (!id) return;
    const isPoints = product?.channel === 'POINTS';
    const priceCents = toCents(row.priceYuan);
    if (!isPoints && priceCents <= 0) {
      toast('价格必须大于 0', 'error');
      return;
    }
    const pointsCost = Number(row.pointsCostText);
    if (isPoints && (!Number.isInteger(pointsCost) || pointsCost <= 0)) {
      toast('兑换积分必须为正整数', 'error');
      return;
    }
    const pointsMoneyCents = toCents(row.pointsMoneyYuan || '0');
    if (isPoints && pointsMoneyCents < 0) {
      toast('加价金额不能为负', 'error');
      return;
    }
    const stock = Number(row.stockText);
    if (!Number.isInteger(stock) || stock < 0) {
      toast('库存必须为非负整数', 'error');
      return;
    }
    setSavingId(row.id);
    try {
      await api(`/admin/products/${id}/skus/${row.id}`, {
        method: 'PATCH',
        body: isPoints
          ? { pointsCost, pointsMoneyCents, stock, status: row.status }
          : { priceCents, stock, status: row.status },
      });
      toast('已保存');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSavingId('');
    }
  }

  const isPoints = product?.channel === 'POINTS';

  const columns: Column<EditableSku>[] = [
    { key: 'code', title: 'SKU 编码', render: (row) => <span className="mono small">{row.code}</span> },
    {
      key: 'spec',
      title: '规格',
      render: (row) =>
        Object.entries(row.specJson)
          .map(([key, value]) => `${key}：${value}`)
          .join(' / ') || '—',
    },
    ...(isPoints
      ? ([
          {
            key: 'pointsCost',
            title: '兑换积分',
            align: 'right',
            render: (row: EditableSku, index: number) => (
              <input
                className="input"
                style={{ width: 100, textAlign: 'right' }}
                type="number"
                min={1}
                value={row.pointsCostText}
                disabled={!canWrite}
                onChange={(e) => updateRow(index, { pointsCostText: e.target.value })}
              />
            ),
          },
          {
            key: 'pointsMoney',
            title: '加价（元）',
            align: 'right',
            render: (row: EditableSku, index: number) => (
              <input
                className="input"
                style={{ width: 100, textAlign: 'right' }}
                type="number"
                step="0.01"
                value={row.pointsMoneyYuan}
                disabled={!canWrite}
                onChange={(e) => updateRow(index, { pointsMoneyYuan: e.target.value })}
              />
            ),
          },
        ] as Column<EditableSku>[])
      : ([
          {
            key: 'price',
            title: '价格（元）',
            align: 'right',
            render: (row: EditableSku, index: number) => (
              <input
                className="input"
                style={{ width: 110, textAlign: 'right' }}
                type="number"
                step="0.01"
                value={row.priceYuan}
                disabled={!canWrite}
                onChange={(e) => updateRow(index, { priceYuan: e.target.value })}
              />
            ),
          },
        ] as Column<EditableSku>[])),
    {
      key: 'stock',
      title: '库存',
      align: 'right',
      render: (row, index) => (
        <input
          className="input"
          style={{ width: 100, textAlign: 'right' }}
          type="number"
          value={row.stockText}
          disabled={!canWrite}
          onChange={(e) => updateRow(index, { stockText: e.target.value })}
        />
      ),
    },
    {
      key: 'status',
      title: '状态',
      render: (row, index) => (
        <select
          className="select"
          value={row.status}
          disabled={!canWrite}
          onChange={(e) => updateRow(index, { status: e.target.value })}
        >
          {SKU_STATUSES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      align: 'right',
      render: (row) =>
        canWrite ? (
          <Button
            size="sm"
            variant="ghost"
            loading={savingId === row.id}
            onClick={() => void saveRow(row)}
          >
            保存
          </Button>
        ) : (
          <Tag>只读</Tag>
        ),
    },
  ];

  if (loading) {
    return (
      <>
        <PageHeader title="规格库存" />
        <div className="table-loading">加载中…</div>
      </>
    );
  }

  if (notFound || !product) {
    return (
      <>
        <PageHeader title="规格库存" />
        <Card>
          <div className="empty">商品不存在或已被删除</div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`规格库存 · ${product.title}`}
        desc={
          isPoints
            ? '修改 SKU 兑换积分、加价金额、库存与状态，保存后商品价格区间会自动重算'
            : '修改 SKU 价格、库存与状态，保存后商品价格区间会自动重算'
        }
        actions={
          <Button
            variant="ghost"
            onClick={() => navigate(isPoints ? '/marketing/points-mall' : '/products')}
          >
            返回列表
          </Button>
        }
      />

      <Card>
        {!canWrite && (
          <p className="small muted" style={{ marginTop: 0 }}>
            当前角色仅可查看 SKU，无法修改价格与库存。
          </p>
        )}
        <DataTable columns={columns} rows={rows} loading={loading} empty="该商品暂无 SKU" />
      </Card>
    </>
  );
}
