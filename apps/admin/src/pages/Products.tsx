import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError, money } from '../api/client';
import { assetPreviewUrl } from '../api/assets';
import { can } from '../auth';
import { toast } from '../components/toast';
import {
  BulkBar,
  Button,
  Card,
  Confirm,
  DataTable,
  PageHeader,
  Pagination,
  RowActions,
  Tag,
  Toolbar,
  type Column,
} from '../components/ui';
import { useListQuery } from '../hooks/useListQuery';

interface ProductRow {
  id: string;
  title: string;
  subtitle?: string | null;
  status: string;
  categoryName: string;
  mainImageKey: string | null;
  priceMinCents: number;
  priceMaxCents: number;
  soldCount: number;
  stock: number;
  skuCount: number;
  createdAt: string;
}

interface CategoryNode {
  id: string;
  name: string;
  children?: CategoryNode[];
}

const STATUS_LABEL: Record<string, string> = {
  ON_SALE: '在售',
  OFF_SHELF: '已下架',
  SOLD_OUT: '已售罄',
};

function statusTone(status: string): 'ok' | 'muted' | 'danger' {
  if (status === 'ON_SALE') return 'ok';
  if (status === 'SOLD_OUT') return 'danger';
  return 'muted';
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

const LIST_DEFAULTS = {
  keyword: '',
  status: '',
  categoryId: '',
  minPrice: '',
  maxPrice: '',
  sort: '',
  page: '1',
  pageSize: '20',
};

interface BatchResult {
  total: number;
  success: number;
  failed: number;
  errors?: { id: string; message: string }[];
}

export default function Products() {
  const navigate = useNavigate();
  const canWrite = can('product.edit');
  const [query, patchQuery] = useListQuery(LIST_DEFAULTS);
  const page = Math.max(Number(query.page) || 1, 1);
  const pageSize = Number(query.pageSize) || 20;
  const [items, setItems] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [keywordDraft, setKeywordDraft] = useState(query.keyword);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<ProductRow | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batching, setBatching] = useState(false);

  async function loadProducts() {
    setLoading(true);
    try {
      const result = await api<{ total: number; items: ProductRow[] }>('/admin/products', {
        query: {
          keyword: query.keyword || undefined,
          status: query.status || undefined,
          categoryId: query.categoryId || undefined,
          minPriceCents: query.minPrice ? Math.round(Number(query.minPrice) * 100) : undefined,
          maxPriceCents: query.maxPrice ? Math.round(Number(query.maxPrice) * 100) : undefined,
          sort: query.sort || undefined,
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

  async function loadCategories() {
    try {
      const result = await api<CategoryNode[]>('/admin/categories');
      setCategories(result);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  useEffect(() => {
    void loadCategories();
  }, []);

  useEffect(() => {
    setKeywordDraft(query.keyword);
  }, [query.keyword]);

  useEffect(() => {
    void loadProducts();
  }, [query.keyword, query.status, query.categoryId, query.minPrice, query.maxPrice, query.sort, page, pageSize]);

  useEffect(() => {
    setSelected([]);
  }, [query.keyword, query.status, query.categoryId]);

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    patchQuery({ keyword: keywordDraft.trim(), page: '1' });
  }

  async function toggleStatus(row: ProductRow) {
    const next = row.status === 'ON_SALE' ? 'OFF_SHELF' : 'ON_SALE';
    try {
      await api(`/admin/products/${row.id}`, { method: 'PATCH', body: { status: next } });
      toast('已保存');
      await loadProducts();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  async function remove(row: ProductRow) {
    try {
      await api(`/admin/products/${row.id}`, { method: 'DELETE' });
      toast('已删除');
      await loadProducts();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setDeleting(null);
    }
  }

  async function batchStatus(status: 'ON_SALE' | 'OFF_SHELF') {
    setBatching(true);
    try {
      const result = await api<BatchResult>('/admin/products/batch/status', {
        method: 'PATCH',
        body: { ids: selected, status },
      });
      toast(
        `已${status === 'ON_SALE' ? '上架' : '下架'} ${result.success} 个商品${
          result.failed ? `，${result.failed} 个失败` : ''
        }`,
        result.failed ? 'error' : 'success',
      );
      setSelected([]);
      await loadProducts();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBatching(false);
    }
  }

  async function batchRemove() {
    setBatching(true);
    try {
      const result = await api<BatchResult>('/admin/products/batch/delete', {
        method: 'POST',
        body: { ids: selected },
      });
      toast(
        result.failed
          ? `已删除 ${result.success} 个，${result.failed} 个失败：${result.errors?.[0]?.message ?? ''}`
          : `已删除 ${result.success} 个商品`,
        result.failed ? 'error' : 'success',
      );
      setSelected([]);
      setBatchDeleteOpen(false);
      await loadProducts();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBatching(false);
    }
  }

  const columns: Column<ProductRow>[] = [
    {
      key: 'title',
      title: '商品',
      minWidth: 260,
      render: (row) => {
        // 仅上传到素材库的图片可预览；历史静态 key（如 products/xxx.jpg）在后台无对应资源
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
              <div className="small muted cell-clip" title={row.subtitle ?? ''}>
                {row.subtitle || '—'}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'status',
      title: '状态',
      minWidth: 76,
      render: (row) => <Tag tone={statusTone(row.status)}>{STATUS_LABEL[row.status] ?? row.status}</Tag>,
    },
    {
      key: 'categoryName',
      title: '分类',
      minWidth: 80,
      render: (row) => <span className="small">{row.categoryName}</span>,
    },
    {
      key: 'price',
      title: '价格区间',
      align: 'right',
      minWidth: 120,
      render: (row) => (
        <span className="money">
          {row.priceMinCents === row.priceMaxCents
            ? money(row.priceMinCents)
            : `${money(row.priceMinCents)} ~ ${money(row.priceMaxCents)}`}
        </span>
      ),
    },
    {
      key: 'stock',
      title: '库存',
      align: 'right',
      minWidth: 64,
      render: (row) => <span className="mono">{row.stock}</span>,
    },
    {
      key: 'skuCount',
      title: 'SKU 数',
      align: 'right',
      minWidth: 64,
      render: (row) => <span className="mono">{row.skuCount}</span>,
    },
    {
      key: 'soldCount',
      title: '销量',
      align: 'right',
      minWidth: 64,
      render: (row) => <span className="mono">{row.soldCount}</span>,
    },
    {
      key: 'actions',
      title: '操作',
      align: 'right',
      minWidth: 130,
      render: (row) => (
        <RowActions
          primary={
            canWrite
              ? { label: '编辑', onClick: () => navigate(`/products/${row.id}/edit`) }
              : { label: '查看规格', onClick: () => navigate(`/products/${row.id}/stock`) }
          }
          actions={[
            {
              label: '规格库存',
              onClick: () => navigate(`/products/${row.id}/stock`),
              hidden: !canWrite,
            },
            {
              label: row.status === 'ON_SALE' ? '下架' : '上架',
              onClick: () => void toggleStatus(row),
              hidden: !canWrite,
            },
            {
              label: '删除',
              danger: true,
              onClick: () => setDeleting(row),
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
        title="商品列表"
        desc="维护商品基础信息、SKU 库存与上下架状态"
        actions={
          canWrite ? (
            <Button onClick={() => navigate('/products/new')}>新建商品</Button>
          ) : undefined
        }
      />

      <Card>
        <form onSubmit={handleSearch}>
          <Toolbar>
            <input
              className="input"
              style={{ width: 240 }}
              aria-label="搜索商品标题"
              placeholder="搜索商品标题…"
              value={keywordDraft}
              onChange={(e) => setKeywordDraft(e.target.value)}
            />
            <select
              className="select"
              aria-label="商品状态"
              value={query.status}
              onChange={(e) => patchQuery({ status: e.target.value, page: '1' })}
            >
              <option value="">全部状态</option>
              <option value="ON_SALE">在售</option>
              <option value="OFF_SHELF">已下架</option>
              <option value="SOLD_OUT">已售罄</option>
            </select>
            <select
              className="select"
              aria-label="商品分类"
              value={query.categoryId}
              onChange={(e) => patchQuery({ categoryId: e.target.value, page: '1' })}
            >
              <option value="">全部分类</option>
              {categories.map((root) => (
                <optgroup key={root.id} label={root.name}>
                  <option value={root.id}>{root.name}</option>
                  {(root.children ?? []).map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select
              className="select"
              aria-label="商品排序"
              value={query.sort}
              onChange={(e) => patchQuery({ sort: e.target.value, page: '1' })}
            >
              <option value="">默认排序</option>
              <option value="newest">最新创建</option>
              <option value="price_asc">价格从低到高</option>
              <option value="price_desc">价格从高到低</option>
              <option value="sales">销量优先</option>
            </select>
            <input
              className="input"
              style={{ width: 100 }}
              type="number"
              min="0"
              aria-label="最低价"
              placeholder="最低价"
              value={query.minPrice}
              onChange={(e) => patchQuery({ minPrice: e.target.value, page: '1' })}
            />
            <span className="muted small">—</span>
            <input
              className="input"
              style={{ width: 100 }}
              type="number"
              min="0"
              aria-label="最高价"
              placeholder="最高价"
              value={query.maxPrice}
              onChange={(e) => patchQuery({ maxPrice: e.target.value, page: '1' })}
            />
            <div className="toolbar-actions">
              <Button
                type="button"
                variant="plain"
                onClick={() => {
                  setKeywordDraft('');
                  patchQuery({
                    keyword: '',
                    status: '',
                    categoryId: '',
                    minPrice: '',
                    maxPrice: '',
                    sort: '',
                    page: '1',
                  });
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
          empty="还没有商品，先新建一个吧"
          selection={{ selected, onChange: setSelected }}
        />
        <Pagination
          page={page}
          total={total}
          pageSize={pageSize}
          onChange={(next) => patchQuery({ page: String(next) })}
          onPageSizeChange={(size) => patchQuery({ pageSize: String(size), page: '1' })}
        />
      </Card>

      <BulkBar
        count={selected.length}
        onClear={() => setSelected([])}
        actions={[
          { label: '批量上架', onClick: () => void batchStatus('ON_SALE'), disabled: batching },
          { label: '批量下架', onClick: () => void batchStatus('OFF_SHELF'), disabled: batching },
          { label: '批量删除', danger: true, onClick: () => setBatchDeleteOpen(true), disabled: batching },
        ]}
      />

      <Confirm
        open={Boolean(deleting)}
        title="删除商品"
        danger
        confirmText="删除"
        text={`确定删除「${deleting?.title ?? ''}」吗？已产生订单的商品只能下架。`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void remove(deleting);
        }}
      />

      <Confirm
        open={batchDeleteOpen}
        title="批量删除商品"
        danger
        confirmText="删除"
        text={`确定删除选中的 ${selected.length} 个商品吗？已产生订单的商品会跳过并返回原因。`}
        onCancel={() => setBatchDeleteOpen(false)}
        onConfirm={() => void batchRemove()}
      />
    </>
  );
}
