import { useEffect, useState } from 'react';

import { api, ApiError } from '../api/client';
import { assetPreviewUrl } from '../api/assets';
import { AssetPicker } from '../components/AssetPicker';
import { toast } from '../components/toast';
import {
  Button,
  Card,
  Field,
  PageHeader,
  Tag,
} from '../components/ui';

type LinkType = 'product' | 'category' | 'search' | 'page' | 'none';

interface ProductOption {
  id: string;
  title: string;
  status: string;
  mainImageKey: string | null;
}

interface CategoryOption {
  id: string;
  name: string;
}

interface BannerDraft {
  draftId: string;
  imageKey: string;
  title: string;
  linkType: LinkType;
  linkValue: string;
  sort: number;
  enabled: boolean;
}

interface NavDraft {
  draftId: string;
  name: string;
  iconKey: string;
  linkType: LinkType;
  linkValue: string;
  sort: number;
  enabled: boolean;
}

interface SectionDraft {
  draftId: string;
  title: string;
  productIds: string[];
  sort: number;
  enabled: boolean;
}

interface LayoutResponse {
  banners: Array<Omit<BannerDraft, 'draftId'>>;
  navs: Array<Omit<NavDraft, 'draftId'>>;
  sections: Array<{ id: string; title: string; productIds: string[]; sort: number; enabled: boolean }>;
}

const LINK_OPTIONS: { value: LinkType; label: string }[] = [
  { value: 'product', label: '商品详情' },
  { value: 'category', label: '分类列表' },
  { value: 'search', label: '搜索关键词' },
  { value: 'page', label: '小程序页面' },
  { value: 'none', label: '不跳转' },
];

function newId(): string {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : '操作失败';
}

function LinkFields({
  type,
  value,
  onChange,
  products,
  categories,
}: {
  type: LinkType;
  value: string;
  onChange: (type: LinkType, value: string) => void;
  products: ProductOption[];
  categories: CategoryOption[];
}) {
  return (
    <div className="grid grid-2">
      <Field label="跳转类型">
        <select
          className="input"
          value={type}
          onChange={(e) => onChange(e.target.value as LinkType, '')}
        >
          {LINK_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      {type === 'product' && (
        <Field label="目标商品">
          <select className="input" value={value} onChange={(e) => onChange(type, e.target.value)}>
            <option value="">请选择商品</option>
            {products
              .filter((product) => product.status === 'ON_SALE')
              .map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title}
                </option>
              ))}
          </select>
        </Field>
      )}
      {type === 'category' && (
        <Field label="目标分类">
          <select className="input" value={value} onChange={(e) => onChange(type, e.target.value)}>
            <option value="">请选择分类</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {type === 'search' && (
        <Field label="搜索关键词">
          <input
            className="input"
            value={value}
            placeholder="例如 普洱"
            onChange={(e) => onChange(type, e.target.value)}
          />
        </Field>
      )}
      {type === 'page' && (
        <Field label="页面路径" hint="例如 /pages/coupon/index">
          <input
            className="input"
            value={value}
            placeholder="/pages/coupon/index"
            onChange={(e) => onChange(type, e.target.value)}
          />
        </Field>
      )}
    </div>
  );
}

export default function HomeLayout() {
  const [banners, setBanners] = useState<BannerDraft[]>([]);
  const [navs, setNavs] = useState<NavDraft[]>([]);
  const [sections, setSections] = useState<SectionDraft[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [layout, productResult, categoryResult] = await Promise.all([
        api<LayoutResponse>('/admin/home-layout'),
        api<{ items: ProductOption[] }>('/admin/products'),
        api<CategoryOption[]>('/categories'),
      ]);
      setBanners(layout.banners.map((item) => ({ ...item, draftId: newId() })));
      setNavs(layout.navs.map((item) => ({ ...item, draftId: newId() })));
      setSections(
        layout.sections.map((item) => ({
          draftId: item.id,
          title: item.title,
          productIds: Array.isArray(item.productIds) ? item.productIds : [],
          sort: item.sort,
          enabled: item.enabled,
        })),
      );
      setProducts(productResult.items);
      setCategories(categoryResult.map((item) => ({ id: item.id, name: item.name })));
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function updateBanner(index: number, patch: Partial<BannerDraft>) {
    setBanners((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function updateNav(index: number, patch: Partial<NavDraft>) {
    setNavs((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function updateSection(index: number, patch: Partial<SectionDraft>) {
    setSections((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function toggleProduct(index: number, productId: string) {
    setSections((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const exists = item.productIds.includes(productId);
        return {
          ...item,
          productIds: exists
            ? item.productIds.filter((id) => id !== productId)
            : [...item.productIds, productId],
        };
      }),
    );
  }

  async function save() {
    setSaving(true);
    try {
      await api('/admin/home-layout', {
        method: 'PUT',
        body: {
          banners: banners.map((item) => ({
            imageKey: item.imageKey,
            title: item.title.trim(),
            linkType: item.linkType,
            linkValue: item.linkValue,
            sort: item.sort,
            enabled: item.enabled,
          })),
          navs: navs.map((item) => ({
            name: item.name.trim(),
            iconKey: item.iconKey || null,
            linkType: item.linkType,
            linkValue: item.linkValue,
            sort: item.sort,
            enabled: item.enabled,
          })),
          sections: sections.map((item) => ({
            title: item.title.trim(),
            productIds: item.productIds,
            sort: item.sort,
            enabled: item.enabled,
          })),
        },
      });
      toast('已保存，首页即时生效');
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  function move<T>(list: T[], setList: (next: T[]) => void, index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    setList(next);
  }

  if (loading) {
    return (
      <>
        <PageHeader title="首页运营位" />
        <div className="table-loading">加载中…</div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="首页运营位"
        desc="轮播、金刚区与推荐位；保存后小程序首页即时生效"
        actions={
          <Button loading={saving} onClick={() => void save()}>
            保存并发布
          </Button>
        }
      />

      <Card
        title="轮播图"
        extra={
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setBanners((prev) => [
                ...prev,
                {
                  draftId: newId(),
                  imageKey: '',
                  title: '',
                  linkType: 'none',
                  linkValue: '',
                  sort: prev.length * 10,
                  enabled: true,
                },
              ])
            }
          >
            添加轮播
          </Button>
        }
      >
        {!banners.length && <p className="muted small">未配置轮播时，小程序展示默认品牌头图。</p>}
        {banners.map((banner, index) => (
          <div
            key={banner.draftId}
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: 12,
              marginBottom: 12,
            }}
          >
            <div className="row-between" style={{ marginBottom: 8 }}>
              <strong className="small">轮播 {index + 1}</strong>
              <div className="row" style={{ gap: 6 }}>
                <Button size="sm" variant="plain" onClick={() => move(banners, setBanners, index, -1)}>
                  上移
                </Button>
                <Button size="sm" variant="plain" onClick={() => move(banners, setBanners, index, 1)}>
                  下移
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setBanners((prev) => prev.filter((item) => item.draftId !== banner.draftId))}
                >
                  删除
                </Button>
              </div>
            </div>
            <div className="grid grid-2">
              <AssetPicker
                value={banner.imageKey}
                onChange={(key) => updateBanner(index, { imageKey: key })}
              />
              <Field label="标题（选填）">
                <input
                  className="input"
                  value={banner.title}
                  onChange={(e) => updateBanner(index, { title: e.target.value })}
                />
              </Field>
            </div>
            {banner.imageKey && (
              <img
                src={assetPreviewUrl(banner.imageKey)}
                alt="轮播预览"
                style={{ width: '100%', maxWidth: 360, borderRadius: 'var(--radius-sm)', marginBottom: 8 }}
              />
            )}
            <LinkFields
              type={banner.linkType}
              value={banner.linkValue}
              products={products}
              categories={categories}
              onChange={(linkType, linkValue) => updateBanner(index, { linkType, linkValue })}
            />
            <div className="row" style={{ gap: 16 }}>
              <label className="small row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={banner.enabled}
                  onChange={(e) => updateBanner(index, { enabled: e.target.checked })}
                />
                启用
              </label>
              <label className="small row" style={{ gap: 6 }}>
                排序
                <input
                  className="input"
                  style={{ width: 80 }}
                  type="number"
                  value={banner.sort}
                  onChange={(e) => updateBanner(index, { sort: Number(e.target.value) || 0 })}
                />
              </label>
            </div>
          </div>
        ))}
      </Card>

      <Card
        title="金刚区"
        extra={
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setNavs((prev) => [
                ...prev,
                {
                  draftId: newId(),
                  name: '',
                  iconKey: '',
                  linkType: 'category',
                  linkValue: '',
                  sort: prev.length * 10,
                  enabled: true,
                },
              ])
            }
          >
            添加入口
          </Button>
        }
      >
        {!navs.length && <p className="muted small">未配置时，小程序使用分类作为默认入口。</p>}
        {navs.map((nav, index) => (
          <div
            key={nav.draftId}
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: 12,
              marginBottom: 12,
            }}
          >
            <div className="row-between" style={{ marginBottom: 8 }}>
              <strong className="small">入口 {index + 1}</strong>
              <div className="row" style={{ gap: 6 }}>
                <Button size="sm" variant="plain" onClick={() => move(navs, setNavs, index, -1)}>
                  上移
                </Button>
                <Button size="sm" variant="plain" onClick={() => move(navs, setNavs, index, 1)}>
                  下移
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setNavs((prev) => prev.filter((item) => item.draftId !== nav.draftId))}
                >
                  删除
                </Button>
              </div>
            </div>
            <div className="grid grid-2">
              <Field label="入口名称">
                <input
                  className="input"
                  value={nav.name}
                  placeholder="例如 新人专享"
                  onChange={(e) => updateNav(index, { name: e.target.value })}
                />
              </Field>
              <AssetPicker
                value={nav.iconKey}
                onChange={(key) => updateNav(index, { iconKey: key })}
                hint="图标（选填，建议方形）"
              />
            </div>
            <LinkFields
              type={nav.linkType}
              value={nav.linkValue}
              products={products}
              categories={categories}
              onChange={(linkType, linkValue) => updateNav(index, { linkType, linkValue })}
            />
            <div className="row" style={{ gap: 16 }}>
              <label className="small row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={nav.enabled}
                  onChange={(e) => updateNav(index, { enabled: e.target.checked })}
                />
                启用
              </label>
              <label className="small row" style={{ gap: 6 }}>
                排序
                <input
                  className="input"
                  style={{ width: 80 }}
                  type="number"
                  value={nav.sort}
                  onChange={(e) => updateNav(index, { sort: Number(e.target.value) || 0 })}
                />
              </label>
            </div>
          </div>
        ))}
      </Card>

      <Card
        title="推荐位"
        extra={
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setSections((prev) => [
                ...prev,
                {
                  draftId: newId(),
                  title: '精选好物',
                  productIds: [],
                  sort: prev.length * 10,
                  enabled: true,
                },
              ])
            }
          >
            添加推荐位
          </Button>
        }
      >
        {!sections.length && <p className="muted small">未配置时，小程序展示默认「精选好物」。</p>}
        {sections.map((section, index) => (
          <div
            key={section.draftId}
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: 12,
              marginBottom: 12,
            }}
          >
            <div className="grid grid-2">
              <Field label="推荐位标题">
                <input
                  className="input"
                  value={section.title}
                  onChange={(e) => updateSection(index, { title: e.target.value })}
                />
              </Field>
              <Field label="排序 / 状态">
                <div className="row" style={{ gap: 12 }}>
                  <input
                    className="input"
                    style={{ width: 90 }}
                    type="number"
                    value={section.sort}
                    onChange={(e) => updateSection(index, { sort: Number(e.target.value) || 0 })}
                  />
                  <label className="small row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={section.enabled}
                      onChange={(e) => updateSection(index, { enabled: e.target.checked })}
                    />
                    启用
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setSections((prev) => prev.filter((item) => item.draftId !== section.draftId))
                    }
                  >
                    删除
                  </Button>
                </div>
              </Field>
            </div>
            <Field label={`选择商品（已选 ${section.productIds.length}，顺序按勾选先后）`}>
              <div
                style={{
                  maxHeight: 220,
                  overflow: 'auto',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 8,
                }}
              >
                {products.map((product) => (
                  <label
                    key={product.id}
                    className="row small"
                    style={{ gap: 8, padding: '4px 0', opacity: product.status === 'ON_SALE' ? 1 : 0.5 }}
                  >
                    <input
                      type="checkbox"
                      disabled={product.status !== 'ON_SALE'}
                      checked={section.productIds.includes(product.id)}
                      onChange={() => toggleProduct(index, product.id)}
                    />
                    <span className="grow">{product.title}</span>
                    {product.status !== 'ON_SALE' && <Tag tone="muted">已下架</Tag>}
                  </label>
                ))}
                {!products.length && <span className="muted small">暂无商品</span>}
              </div>
            </Field>
          </div>
        ))}
      </Card>

      <Card title="保存前检查">
        <p className="small muted" style={{ margin: 0 }}>
          轮播最多 6 张、金刚区最多 10 个、推荐位最多 6 个；图片必须来自素材库，
          推荐位只允许上架商品。保存后小程序刷新首页即可看到最新配置。
        </p>
      </Card>
    </>
  );
}
