import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError, money } from '../api/client';
import { assetPreviewUrl } from '../api/assets';
import { can } from '../auth';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  Pagination,
  RowActions,
  Tag,
  Toolbar,
  type Column,
} from '../components/ui';
import { useListQuery } from '../hooks/useListQuery';

interface PointsProductRow {
  id: string;
  title: string;
  status: string;
  mainImageKey: string | null;
  stock: number;
  skuCount: number;
  pointsCostMin: number | null;
  pointsCostMax: number | null;
  pointsMoneyCentsMin: number | null;
  pointsLimitPerUser: number;
  exchangedQty: number;
}

const STATUS_LABEL: Record<string, string> = {
  ON_SALE: '在售',
  OFF_SHELF: '已下架',
  SOLD_OUT: '已售罄',
};

const LIST_DEFAULTS = {
  keyword: '',
  status: '',
  page: '1',
  pageSize: '20',
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

function pointsText(row: PointsProductRow): string {
  if (row.pointsCostMin === null) return '—';
  const points =
    row.pointsCostMin === row.pointsCostMax
      ? `${row.pointsCostMin} 积分`
      : `${row.pointsCostMin} 积分起`;
  return points;
}

export default function PointsMall() {
  const navigate = useNavigate();
  const canWrite = can('pointsmall.manage');
  const [query, patchQuery] = useListQuery(LIST_DEFAULTS);
  const page = Math.max(Number(query.page) || 1, 1);
  const pageSize = Number(query.pageSize) || 20;
  const [items, setItems] = useState<PointsProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [keywordDraft, setKeywordDraft] = useState(query.keyword);
  const [loading, setLoading] = useState(true);

  async function loadProducts() {
    setLoading(true);
    try {
      const result = await api<{ total: number; items: PointsProductRow[] }>('/admin/products', {
        query: {
          channel: 'POINTS',
          keyword: query.keyword || undefined,
          status: query.status || undefined,
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
    void loadProducts();
  }, [query]);

  async function toggleStatus(row: PointsProductRow) {
    try {
      await api('/admin/products/batch/status', {
        method: 'PATCH',
        body: {
          ids: [row.id],
          status: row.status === 'ON_SALE' ? 'OFF_SHELF' : 'ON_SALE',
        },
      });
      toast(row.status === 'ON_SALE' ? '已下架' : '已上架');
      await loadProducts();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  const columns: Column<PointsProductRow>[] = [
    {
      key: 'title',
      title: '积分商品',
      minWidth: 260,
      render: (row) => {
        const thumb =
          row.mainImageKey && /^(?:https?:\/\/|\/api\/)/i.test(row.mainImageKey)
            ? assetPreviewUrl(row.mainImageKey)
            : '';
        return (
          <div className="cell-product">
            {thumb ? (
              <img className="cell-thumb" src={thumb} alt="" loading="lazy" />
            ) : (
              <span className="cell-thumb cell-thumb--empty" aria-hidden="true">
                无图
              </span>
            )}
            <div className="cell-product-text">
              <div className="cell-title cell-clip" title={row.title}>
                {row.title}
              </div>
              <div className="small muted">{row.skuCount} 个规格</div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'points',
      title: '兑换价',
      minWidth: 140,
      render: (row) => (
        <div>
          <div className="money">{pointsText(row)}</div>
          <div className="small muted">
            {row.pointsMoneyCentsMin ? `+ ${money(row.pointsMoneyCentsMin)}` : '纯积分'}
          </div>
        </div>
      ),
    },
    {
      key: 'stock',
      title: '库存',
      align: 'right',
      minWidth: 64,
      nowrap: true,
      render: (row) =>
        row.stock <= 5 ? (
          <Tag tone="danger">仅剩 {row.stock}</Tag>
        ) : (
          <span className="mono">{row.stock}</span>
        ),
    },
    {
      key: 'exchangedQty',
      title: '已兑',
      align: 'right',
      minWidth: 64,
      nowrap: true,
      render: (row) => <span className="mono">{row.exchangedQty}</span>,
    },
    {
      key: 'pointsLimitPerUser',
      title: '每人限兑',
      align: 'right',
      minWidth: 84,
      nowrap: true,
      render: (row) => (
        <span className="mono">{row.pointsLimitPerUser > 0 ? row.pointsLimitPerUser : '不限'}</span>
      ),
    },
    {
      key: 'status',
      title: '状态',
      minWidth: 76,
      render: (row) => (
        <Tag tone={row.status === 'ON_SALE' ? 'ok' : row.status === 'SOLD_OUT' ? 'danger' : 'muted'}>
          {STATUS_LABEL[row.status] ?? row.status}
        </Tag>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      align: 'right',
      minWidth: 170,
      render: (row) => (
        <RowActions
          primary={{ label: '编辑', onClick: () => navigate(`/products/${row.id}/edit`) }}
          actions={[
            {
              label: '规格库存',
              onClick: () => navigate(`/products/${row.id}/stock`),
            },
            {
              label: row.status === 'ON_SALE' ? '下架' : '上架',
              onClick: () => void toggleStatus(row),
              hidden: !canWrite,
            },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="积分商城"
        desc="维护积分兑换商品、兑换价与每人限兑；兑换单统一包邮"
        actions={
          canWrite ? (
            <Button onClick={() => navigate('/products/new?channel=POINTS')}>添加积分商品</Button>
          ) : undefined
        }
      />

      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            patchQuery({ keyword: keywordDraft.trim(), page: '1' });
          }}
        >
          <Toolbar>
            <input
              className="input"
              style={{ width: 240 }}
              aria-label="搜索积分商品"
              placeholder="搜索积分商品标题…"
              value={keywordDraft}
              onChange={(e) => setKeywordDraft(e.target.value)}
            />
            <select
              className="select"
              aria-label="积分商品状态"
              value={query.status}
              onChange={(e) => patchQuery({ status: e.target.value, page: '1' })}
            >
              <option value="">全部状态</option>
              <option value="ON_SALE">在售</option>
              <option value="OFF_SHELF">已下架</option>
              <option value="SOLD_OUT">已售罄</option>
            </select>
            <div className="toolbar-actions">
              <Button
                type="button"
                variant="plain"
                onClick={() => {
                  setKeywordDraft('');
                  patchQuery({ keyword: '', status: '', page: '1' });
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
          empty="还没有积分商品，先添加一个并设置兑换积分"
        />
        <Pagination
          page={page}
          total={total}
          pageSize={pageSize}
          onChange={(next) => patchQuery({ page: String(next) })}
          onPageSizeChange={(size) => patchQuery({ pageSize: String(size), page: '1' })}
        />
      </Card>
    </>
  );
}
