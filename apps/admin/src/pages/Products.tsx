import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError, money } from '../api/client';
import { hasRole } from '../auth';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  Tag,
  Toolbar,
  type Column,
} from '../components/ui';

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

export default function Products() {
  const navigate = useNavigate();
  const canWrite = hasRole('SUPER', 'OPS');
  const [items, setItems] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadProducts() {
    setLoading(true);
    try {
      const result = await api<{ items: ProductRow[] }>('/admin/products', {
        query: { keyword, status, categoryId },
      });
      setItems(result.items);
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
    void loadProducts();
    void loadCategories();
    // 首次加载
  }, []);

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    void loadProducts();
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
    if (!window.confirm(`确定删除「${row.title}」吗？已产生订单的商品只能下架。`)) return;
    try {
      await api(`/admin/products/${row.id}`, { method: 'DELETE' });
      toast('已删除');
      await loadProducts();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  const columns: Column<ProductRow>[] = [
    {
      key: 'title',
      title: '商品',
      render: (row) => (
        <div>
          <div>{row.title}</div>
          {(row.subtitle || row.mainImageKey) && (
            <div className="small muted">{row.subtitle || row.mainImageKey}</div>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      title: '状态',
      render: (row) => <Tag tone={statusTone(row.status)}>{STATUS_LABEL[row.status] ?? row.status}</Tag>,
    },
    {
      key: 'categoryName',
      title: '分类',
      render: (row) => <span className="small">{row.categoryName}</span>,
    },
    {
      key: 'price',
      title: '价格区间',
      align: 'right',
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
      render: (row) => <span className="mono">{row.stock}</span>,
    },
    {
      key: 'skuCount',
      title: 'SKU 数',
      align: 'right',
      render: (row) => <span className="mono">{row.skuCount}</span>,
    },
    {
      key: 'soldCount',
      title: '销量',
      align: 'right',
      render: (row) => <span className="mono">{row.soldCount}</span>,
    },
    {
      key: 'actions',
      title: '操作',
      align: 'right',
      render: (row) => (
        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
          {canWrite ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => navigate(`/products/${row.id}/edit`)}>
                编辑
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navigate(`/products/${row.id}/stock`)}>
                规格库存
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void toggleStatus(row)}>
                {row.status === 'ON_SALE' ? '下架' : '上架'}
              </Button>
              <Button size="sm" variant="danger" onClick={() => void remove(row)}>
                删除
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => navigate(`/products/${row.id}/stock`)}>
              查看规格
            </Button>
          )}
        </div>
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
              placeholder="搜索商品标题"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">全部状态</option>
              <option value="ON_SALE">在售</option>
              <option value="OFF_SHELF">已下架</option>
              <option value="SOLD_OUT">已售罄</option>
            </select>
            <select
              className="select"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
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
            <Button type="submit" variant="ghost">
              搜索
            </Button>
            <Button
              type="button"
              variant="plain"
              onClick={() => {
                setKeyword('');
                setStatus('');
                setCategoryId('');
              }}
            >
              重置
            </Button>
          </Toolbar>
        </form>

        <DataTable
          columns={columns}
          rows={items}
          loading={loading}
          empty="还没有商品，先新建一个吧"
        />
      </Card>
    </>
  );
}
