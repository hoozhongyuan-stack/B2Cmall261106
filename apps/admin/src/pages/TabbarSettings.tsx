import { useEffect, useState } from 'react';

import { tokens } from '@shanye/tokens';
import {
  MICRO_INNER_PAGES,
  MICRO_PAGE_LIMITS,
  type ShopTabbarConfig,
  type ShopTabbarItem,
} from '@shanye/shared/src/microPage';

import { ApiError } from '../api/client';
import { getTabbar, saveTabbar } from '../api/microPages';
import { assetPreviewUrl } from '../api/assets';
import { AssetPicker } from '../components/AssetPicker';
import { LinkField, ColorInput, TextInput } from '../components/microPage/fields';
import { Button, Field, PageHeader } from '../components/ui';
import { toast } from '../components/toast';

const EMPTY: ShopTabbarConfig = {
  enabled: true,
  style: { background: '', color: '', selectedColor: '', borderTop: true },
  items: [
    { key: 'home', text: '首页', iconKey: null, activeIconKey: null, link: { type: 'page', value: '/pages/home/index' } },
    { key: 'category', text: '分类', iconKey: null, activeIconKey: null, link: { type: 'page', value: '/pages/category/index' } },
    { key: 'cart', text: '购物车', iconKey: null, activeIconKey: null, link: { type: 'page', value: '/pages/cart/index' } },
    { key: 'mine', text: '我的', iconKey: null, activeIconKey: null, link: { type: 'page', value: '/pages/mine/index' } },
  ],
};

export default function TabbarSettings() {
  const [config, setConfig] = useState<ShopTabbarConfig>({ ...EMPTY });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void getTabbar()
      .then((data) => {
        if (alive) setConfig({ ...EMPTY, ...data, style: { ...EMPTY.style, ...data.style } });
      })
      .catch((err) => toast(err instanceof Error ? err.message : '加载失败', 'error'))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  function patchItem(index: number, patch: Partial<ShopTabbarItem>) {
    setConfig((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  function moveItem(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= config.items.length) return;
    const items = [...config.items];
    [items[index], items[target]] = [items[target], items[index]];
    setConfig({ ...config, items });
  }

  function removeItem(index: number) {
    setConfig({ ...config, items: config.items.filter((_, i) => i !== index) });
  }

  function addItem() {
    if (config.items.length >= MICRO_PAGE_LIMITS.maxTabbarItems) return;
    setConfig({
      ...config,
      items: [
        ...config.items,
        {
          key: `tab-${Date.now().toString(36)}`,
          text: '新入口',
          iconKey: null,
          activeIconKey: null,
          link: { type: 'page', value: MICRO_INNER_PAGES[0].path },
        },
      ],
    });
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await saveTabbar(config);
      setConfig({ ...saved, style: { ...EMPTY.style, ...saved.style } });
      toast('底部导航已保存，小程序重新进入后生效');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  }

  const style = { ...EMPTY.style, ...config.style };

  if (loading) {
    return (
      <>
        <PageHeader title="底部导航" />
        <div className="table-loading">加载中…</div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="底部导航"
        desc="配置小程序底部 2~5 个入口；必须有 1 个入口指向首页"
        actions={
          <Button loading={saving} onClick={() => void save()}>
            保存导航
          </Button>
        }
      />

      <div className="tabbar-layout">
        <div className="tabbar-form">
          <section className="card">
            <header className="card-hd">
              <h3>外观</h3>
            </header>
            <div className="card-bd grid grid-2">
              <Field label="导航背景色">
                <ColorInput
                  value={style.background ?? ''}
                  fallback={tokens.color.surface}
                  onChange={(next) => setConfig({ ...config, style: { ...style, background: next } })}
                />
              </Field>
              <Field label="默认文字色">
                <ColorInput
                  value={style.color ?? ''}
                  fallback={tokens.color.ink3}
                  onChange={(next) => setConfig({ ...config, style: { ...style, color: next } })}
                />
              </Field>
              <Field label="选中文字色">
                <ColorInput
                  value={style.selectedColor ?? ''}
                  fallback={tokens.color.brand}
                  onChange={(next) => setConfig({ ...config, style: { ...style, selectedColor: next } })}
                />
              </Field>
              <Field label="顶部细线">
                <label className="row small" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={style.borderTop !== false}
                    onChange={(event) =>
                      setConfig({ ...config, style: { ...style, borderTop: event.target.checked } })
                    }
                  />
                  显示
                </label>
              </Field>
            </div>
          </section>

          <section className="card">
            <header className="card-hd">
              <h3>导航入口（{config.items.length}/5）</h3>
              <div className="card-extra">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={config.items.length >= MICRO_PAGE_LIMITS.maxTabbarItems}
                  onClick={addItem}
                >
                  添加入口
                </Button>
              </div>
            </header>
            <div className="card-bd">
              {config.items.map((item, index) => (
                <div key={item.key} className="tabbar-item">
                  <div className="row-between" style={{ marginBottom: 8 }}>
                    <strong className="small">入口 {index + 1}</strong>
                    <div className="row" style={{ gap: 4 }}>
                      <Button size="sm" variant="plain" onClick={() => moveItem(index, -1)}>
                        上移
                      </Button>
                      <Button size="sm" variant="plain" onClick={() => moveItem(index, 1)}>
                        下移
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={config.items.length <= MICRO_PAGE_LIMITS.minTabbarItems}
                        onClick={() => removeItem(index)}
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-2">
                    <Field label="名称" hint="最多 5 个字">
                      <TextInput
                        value={item.text}
                        maxLength={5}
                        onChange={(next) => patchItem(index, { text: next })}
                      />
                    </Field>
                    <LinkField
                      label="跳转目标"
                      value={item.link}
                      onChange={(link) => patchItem(index, { link })}
                    />
                    <AssetPicker
                      value={item.iconKey ?? ''}
                      onChange={(key) => patchItem(index, { iconKey: key || null })}
                      hint="默认图标（选填，建议 81×81）"
                    />
                    <AssetPicker
                      value={item.activeIconKey ?? ''}
                      onChange={(key) => patchItem(index, { activeIconKey: key || null })}
                      hint="选中图标（选填）"
                    />
                  </div>
                </div>
              ))}
              <p className="small muted" style={{ marginBottom: 0 }}>
                自绘导航切页使用 reLaunch，不会保留页面栈；入口链接可指向内置页面、微页面、商品等。
              </p>
            </div>
          </section>
        </div>

        <aside className="tabbar-preview">
          <div className="tabbar-phone">
            <div className="tabbar-phone-body">
              <span className="muted small">页面预览</span>
            </div>
            <div
              className="tabbar-preview-bar"
              style={{
                background: style.background || tokens.color.surface,
                borderTop: style.borderTop === false ? 'none' : '1px solid #ece7dd',
              }}
            >
              {config.items.map((item, index) => (
                <div
                  key={item.key}
                  className="tabbar-preview-item"
                  style={{ color: index === 0 ? style.selectedColor || tokens.color.brand : style.color || tokens.color.ink3 }}
                >
                  {item.iconKey || item.activeIconKey ? (
                    <img
                      src={assetPreviewUrl(index === 0 ? item.activeIconKey || item.iconKey : item.iconKey)}
                      alt=""
                    />
                  ) : (
                    <span className="tabbar-ph">{item.text.slice(0, 1)}</span>
                  )}
                  <em>{item.text}</em>
                </div>
              ))}
            </div>
          </div>
          <p className="small muted" style={{ textAlign: 'center' }}>
            保存后小程序启动或回到前台时拉取
          </p>
        </aside>
      </div>
    </>
  );
}
