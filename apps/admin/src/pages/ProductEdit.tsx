import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { api, ApiError, toCents, toYuan } from '../api/client';
import { hasRole } from '../auth';
import { AssetPicker } from '../components/AssetPicker';
import { toast } from '../components/toast';
import { Button, Card, DataTable, Field, PageHeader, Tag, type Column } from '../components/ui';

interface CategoryNode {
  id: string;
  name: string;
  children?: CategoryNode[];
}

interface ProductSku {
  id: string;
  code: string;
  specJson: Record<string, string>;
  priceCents: number;
  stock: number;
  status: string;
}

interface ProductDetail {
  id: string;
  title: string;
  subtitle: string | null;
  status: string;
  categoryId: string;
  mainImageKey: string | null;
  mainImageKeys: string[];
  detailImageKeys: string[];
  detail: string | null;
  sort: number;
  skus: ProductSku[];
}

interface SpecPair {
  key: string;
  value: string;
}

interface SkuForm {
  specs: SpecPair[];
  price: string;
  origin: string;
  stock: string;
}

interface BaseForm {
  title: string;
  subtitle: string;
  categoryId: string;
  status: string;
  sort: string;
  mainImageKeys: string[];
  detailImageKeys: string[];
  detail: string;
}

const EMPTY_FORM: BaseForm = {
  title: '',
  subtitle: '',
  categoryId: '',
  status: 'OFF_SHELF',
  sort: '0',
  mainImageKeys: [],
  detailImageKeys: [],
  detail: '',
};

function emptySku(): SkuForm {
  return { specs: [{ key: '规格', value: '' }], price: '', origin: '', stock: '0' };
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

export default function ProductEdit() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const canWrite = hasRole('SUPER', 'OPS');
  const navigate = useNavigate();

  const [form, setForm] = useState<BaseForm>(EMPTY_FORM);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [skus, setSkus] = useState<SkuForm[]>([emptySku()]);
  const [existingSkus, setExistingSkus] = useState<ProductSku[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadCategories() {
      try {
        const result = await api<CategoryNode[]>('/admin/categories');
        setCategories(result);
      } catch (err) {
        toast(errorText(err), 'error');
      }
    }
    void loadCategories();
  }, []);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    async function loadProduct() {
      setLoading(true);
      try {
        const result = await api<ProductDetail>(`/admin/products/${id}`);
        if (!alive) return;
        setForm({
          title: result.title,
          subtitle: result.subtitle ?? '',
          categoryId: result.categoryId,
          status: result.status === 'ON_SALE' ? 'ON_SALE' : 'OFF_SHELF',
          sort: String(result.sort),
          mainImageKeys:
            result.mainImageKeys?.length > 0
              ? result.mainImageKeys
              : result.mainImageKey
                ? [result.mainImageKey]
                : [],
          detailImageKeys: result.detailImageKeys ?? [],
          detail: result.detail ?? '',
        });
        setExistingSkus(result.skus);
      } catch (err) {
        if (!alive) return;
        setNotFound(true);
        toast(errorText(err), 'error');
      } finally {
        if (alive) setLoading(false);
      }
    }
    void loadProduct();
    return () => {
      alive = false;
    };
  }, [id]);

  function setField<K extends keyof BaseForm>(key: K, value: BaseForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateSku(index: number, patch: Partial<SkuForm>) {
    setSkus((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function updateSpec(skuIndex: number, specIndex: number, patch: Partial<SpecPair>) {
    setSkus((prev) =>
      prev.map((row, i) => {
        if (i !== skuIndex) return row;
        return {
          ...row,
          specs: row.specs.map((pair, j) => (j === specIndex ? { ...pair, ...patch } : pair)),
        };
      }),
    );
  }

  function addSpec(skuIndex: number) {
    setSkus((prev) =>
      prev.map((row, i) =>
        i === skuIndex ? { ...row, specs: [...row.specs, { key: '', value: '' }] } : row,
      ),
    );
  }

  function removeSpec(skuIndex: number, specIndex: number) {
    setSkus((prev) =>
      prev.map((row, i) =>
        i === skuIndex ? { ...row, specs: row.specs.filter((_, j) => j !== specIndex) } : row,
      ),
    );
  }

  function addSku() {
    setSkus((prev) => [...prev, emptySku()]);
  }

  function removeSku(index: number) {
    if (skus.length <= 1) {
      toast('至少需要保留 1 个 SKU', 'error');
      return;
    }
    setSkus((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      toast('当前角色没有商品编辑权限', 'error');
      return;
    }
    if (!form.title.trim()) {
      toast('请填写商品标题', 'error');
      return;
    }
    if (!form.categoryId) {
      toast('请选择分类', 'error');
      return;
    }
    if (!Number.isInteger(Number(form.sort))) {
      toast('排序必须为整数', 'error');
      return;
    }

    setSaving(true);
    try {
      if (isNew) {
        const payloadSkus = skus.map((row, index) => {
          const specJson: Record<string, string> = {};
          for (const pair of row.specs) {
            const key = pair.key.trim();
            const value = pair.value.trim();
            if (key && value) specJson[key] = value;
          }
          if (Object.keys(specJson).length === 0) {
            throw new Error(`第 ${index + 1} 个 SKU 请填写规格`);
          }
          const priceCents = toCents(row.price);
          if (priceCents <= 0) throw new Error(`第 ${index + 1} 个 SKU 价格必须大于 0`);
          const stock = Number(row.stock);
          if (!Number.isInteger(stock) || stock < 0) {
            throw new Error(`第 ${index + 1} 个 SKU 库存必须为非负整数`);
          }
          return {
            specJson,
            priceCents,
            stock,
            ...(row.origin.trim() ? { originCents: toCents(row.origin) } : {}),
          };
        });

        await api('/admin/products', {
          method: 'POST',
          body: {
            title: form.title.trim(),
            subtitle: form.subtitle.trim() || undefined,
            categoryId: form.categoryId,
            mainImageKeys: form.mainImageKeys,
            detailImageKeys: form.detailImageKeys,
            detail: form.detail.trim() || undefined,
            status: form.status,
            sort: Number(form.sort),
            skus: payloadSkus,
          },
        });
      } else {
        await api(`/admin/products/${id}`, {
          method: 'PATCH',
          body: {
            title: form.title.trim(),
            subtitle: form.subtitle.trim(),
            categoryId: form.categoryId,
            mainImageKeys: form.mainImageKeys,
            detailImageKeys: form.detailImageKeys,
            detail: form.detail.trim(),
            status: form.status,
            sort: Number(form.sort),
          },
        });
      }
      toast('已保存');
      navigate('/products');
    } catch (err) {
      toast(err instanceof Error ? err.message : errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  const skuColumns: Column<ProductSku>[] = [
    { key: 'code', title: 'SKU 编码', render: (row) => <span className="mono small">{row.code}</span> },
    {
      key: 'spec',
      title: '规格',
      render: (row) =>
        Object.entries(row.specJson)
          .map(([key, value]) => `${key}：${value}`)
          .join(' / ') || '—',
    },
    { key: 'priceCents', title: '价格', align: 'right', render: (row) => <span className="money">{toYuan(row.priceCents)} 元</span> },
    { key: 'stock', title: '库存', align: 'right', render: (row) => <span className="mono">{row.stock}</span> },
    {
      key: 'status',
      title: '状态',
      render: (row) => (
        <Tag tone={row.status === 'ON_SALE' ? 'ok' : row.status === 'SOLD_OUT' ? 'danger' : 'muted'}>
          {row.status === 'ON_SALE' ? '在售' : row.status === 'SOLD_OUT' ? '售罄' : '下架'}
        </Tag>
      ),
    },
  ];

  if (loading) {
    return (
      <>
        <PageHeader title="编辑商品" />
        <div className="table-loading">加载中…</div>
      </>
    );
  }

  if (notFound) {
    return (
      <>
        <PageHeader title="编辑商品" />
        <Card>
          <div className="empty">商品不存在或已被删除</div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={isNew ? '新建商品' : '编辑商品'}
        desc={isNew ? '填写基础信息并至少创建一个 SKU' : 'SKU 价格与库存请前往「规格库存」页维护'}
        actions={
          <Button variant="ghost" onClick={() => navigate('/products')}>
            返回列表
          </Button>
        }
      />

      <form onSubmit={handleSubmit}>
        <Card title="基础信息">
          <div className="grid grid-2">
            <Field label="商品标题">
              <input
                className="input"
                value={form.title}
                placeholder="例如：山野土蜂蜜 500g"
                onChange={(e) => setField('title', e.target.value)}
              />
            </Field>
            <Field label="副标题">
              <input
                className="input"
                value={form.subtitle}
                placeholder="选填，一句话卖点"
                onChange={(e) => setField('subtitle', e.target.value)}
              />
            </Field>
            <Field label="分类">
              <select
                className="select"
                value={form.categoryId}
                onChange={(e) => setField('categoryId', e.target.value)}
              >
                <option value="">请选择分类</option>
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
            </Field>
            <Field label="状态">
              <select
                className="select"
                value={form.status}
                onChange={(e) => setField('status', e.target.value)}
              >
                <option value="OFF_SHELF">下架</option>
                <option value="ON_SALE">上架</option>
              </select>
            </Field>
            <Field label="排序" hint="数值越小越靠前">
              <input
                className="input"
                type="number"
                value={form.sort}
                onChange={(e) => setField('sort', e.target.value)}
              />
            </Field>
            <Field label="商品主图" wide hint="可多选，第一张用于列表与订单，详情页自动轮播">
              <AssetPicker
                multiple
                value={form.mainImageKeys}
                onChange={(keys) => setField('mainImageKeys', keys)}
              />
            </Field>
            <Field label="商品详情图" wide hint="可多选，详情页按顺序上下排列">
              <AssetPicker
                multiple
                value={form.detailImageKeys}
                onChange={(keys) => setField('detailImageKeys', keys)}
              />
            </Field>
            <Field label="详情文案（可选）" wide>
              <textarea
                className="textarea"
                value={form.detail}
                placeholder="补充文字说明，选填"
                onChange={(e) => setField('detail', e.target.value)}
              />
            </Field>
          </div>
        </Card>

        {isNew ? (
          <Card
            title="SKU 规格"
            extra={
              <Button type="button" variant="ghost" size="sm" onClick={addSku}>
                添加 SKU
              </Button>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {skus.map((row, skuIndex) => (
                <div
                  key={skuIndex}
                  style={{
                    padding: 14,
                    background: 'var(--surface-2)',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div className="row-between">
                    <strong>SKU {skuIndex + 1}</strong>
                    <Button type="button" variant="plain" size="sm" onClick={() => removeSku(skuIndex)}>
                      删除
                    </Button>
                  </div>

                  <div className="row" style={{ alignItems: 'flex-end' }}>
                    {row.specs.map((pair, specIndex) => (
                      <div key={specIndex} className="row" style={{ gap: 6 }}>
                        <input
                          className="input"
                          style={{ width: 110 }}
                          placeholder="规格名"
                          value={pair.key}
                          onChange={(e) => updateSpec(skuIndex, specIndex, { key: e.target.value })}
                        />
                        <input
                          className="input"
                          style={{ width: 130 }}
                          placeholder="规格值"
                          value={pair.value}
                          onChange={(e) => updateSpec(skuIndex, specIndex, { value: e.target.value })}
                        />
                        <Button
                          type="button"
                          variant="plain"
                          size="sm"
                          onClick={() => removeSpec(skuIndex, specIndex)}
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                    <Button type="button" variant="ghost" size="sm" onClick={() => addSpec(skuIndex)}>
                      + 规格项
                    </Button>
                  </div>

                  <div className="grid grid-4">
                    <Field label="价格（元）">
                      <input
                        className="input"
                        type="number"
                        step="0.01"
                        value={row.price}
                        onChange={(e) => updateSku(skuIndex, { price: e.target.value })}
                      />
                    </Field>
                    <Field label="划线价（元）" hint="选填">
                      <input
                        className="input"
                        type="number"
                        step="0.01"
                        value={row.origin}
                        onChange={(e) => updateSku(skuIndex, { origin: e.target.value })}
                      />
                    </Field>
                    <Field label="库存">
                      <input
                        className="input"
                        type="number"
                        value={row.stock}
                        onChange={(e) => updateSku(skuIndex, { stock: e.target.value })}
                      />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <>
            <Card
              title="SKU 规格与库存"
              extra={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(`/products/${id}/stock`)}
                >
                  去规格库存页
                </Button>
              }
            >
              <p className="small muted" style={{ margin: 0 }}>
                为保证价格区间与库存一致，SKU 的价格、库存和状态不在本页修改。
              </p>
              <DataTable columns={skuColumns} rows={existingSkus} empty="该商品暂无 SKU" />
            </Card>
          </>
        )}

        <div className="row-between">
          <span className="small muted">提交后价格区间会根据 SKU 自动计算</span>
          <Button type="submit" loading={saving} disabled={!canWrite}>
            保存
          </Button>
        </div>
      </form>
    </>
  );
}
