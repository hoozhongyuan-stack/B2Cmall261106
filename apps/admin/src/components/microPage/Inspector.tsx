import { useEffect, useState } from 'react';

import { tokens } from '@shanye/tokens';
import {
  MICRO_GOODS_LAYOUTS,
  MICRO_GOODS_SOURCES,
  MICRO_PAGE_LIMITS,
  type MicroComponent,
  type MicroComponentStyle,
  type MicroLink,
} from '@shanye/shared/src/microPage';

import { listLinkOptions, type LinkOption } from '../../api/microPages';
import { assetPreviewUrl } from '../../api/assets';
import { AssetPicker } from '../AssetPicker';
import { Button, Field } from '../ui';
import type { PreviewProduct } from './Preview';
import {
  CheckInput,
  ColorInput,
  LinkField,
  NumberInput,
  SelectInput,
  StyleFields,
  TextInput,
} from './fields';

function asProps(component: MicroComponent): Record<string, unknown> {
  return (component.props ?? {}) as Record<string, unknown>;
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) =>
    item && typeof item === 'object' ? { ...(item as Record<string, unknown>) } : {},
  );
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function ComponentInspector({
  component,
  products,
  onChange,
}: {
  component: MicroComponent;
  products: PreviewProduct[];
  onChange: (next: MicroComponent) => void;
}) {
  const props = asProps(component);
  const [categories, setCategories] = useState<LinkOption[]>([]);
  const [seckills, setSeckills] = useState<LinkOption[]>([]);
  const [productKeyword, setProductKeyword] = useState('');

  useEffect(() => {
    void listLinkOptions('category', '', 50).then((result) => setCategories(result.items));
  }, []);

  useEffect(() => {
    if (props.source !== 'seckill') return;
    void listLinkOptions('seckill', '', 50).then((result) => setSeckills(result.items));
  }, [props.source]);

  function patchProps(patch: Record<string, unknown>) {
    onChange({ ...component, props: { ...props, ...patch } });
  }

  function patchStyle(style: MicroComponentStyle) {
    onChange({ ...component, style });
  }

  function updateItem(index: number, patch: Record<string, unknown>) {
    const items = records(props.items);
    items[index] = { ...items[index], ...patch };
    patchProps({ items });
  }

  function moveItem(index: number, delta: number) {
    const items = records(props.items);
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    patchProps({ items });
  }

  function removeItem(index: number) {
    patchProps({ items: records(props.items).filter((_, i) => i !== index) });
  }

  function addBanner() {
    patchProps({ items: [...records(props.items), { imageKey: '', title: '', link: { type: 'none', value: null } }] });
  }

  function addNav() {
    patchProps({ items: [...records(props.items), { name: '', iconKey: '', link: { type: 'none', value: null } }] });
  }

  function updateHotspot(index: number, patch: Record<string, unknown>) {
    const spots = records(props.hotspots);
    spots[index] = { ...spots[index], ...patch };
    patchProps({ hotspots: spots });
  }

  const filteredProducts = products.filter((product) =>
    productKeyword ? product.title.includes(productKeyword) : true,
  );
  const manualIds = strings(props.productIds);
  const show = (props.show ?? {}) as Record<string, boolean>;

  return (
    <div className="micro-inspector">
      <div className="micro-inspector-head">
        <strong>组件属性</strong>
        <CheckInput
          checked={component.visible !== false}
          label="显示"
          onChange={(checked) => onChange({ ...component, visible: checked })}
        />
      </div>

      {component.type === 'notice' && (
        <>
          <Field label="公告文案" required>
            <textarea
              className="input micro-textarea"
              maxLength={MICRO_PAGE_LIMITS.maxNoticeLength}
              value={String(props.text ?? '')}
              onChange={(event) => patchProps({ text: event.target.value })}
            />
          </Field>
          <Field label="前置标签">
            <TextInput
              value={String(props.tag ?? '')}
              maxLength={10}
              placeholder="如 包邮"
              onChange={(next) => patchProps({ tag: next })}
            />
          </Field>
          <div className="row" style={{ gap: 16 }}>
            <CheckInput
              checked={props.scroll !== false}
              label="滚动播放"
              onChange={(next) => patchProps({ scroll: next })}
            />
          </div>
          <Field label="滚动速度（越大越慢）">
            <NumberInput
              value={Number(props.speed ?? 80)}
              min={30}
              max={200}
              onChange={(next) => patchProps({ speed: next })}
            />
          </Field>
          <Field label="文字颜色">
            <ColorInput
              value={String(props.textColor ?? '')}
              fallback={tokens.color.danger}
              onChange={(next) => patchProps({ textColor: next })}
            />
          </Field>
          <LinkField
            value={props.link as MicroLink | undefined}
            onChange={(link) => patchProps({ link })}
          />
        </>
      )}

      {component.type === 'search' && (
        <>
          <Field label="占位文案">
            <TextInput
              value={String(props.placeholder ?? '')}
              maxLength={20}
              onChange={(next) => patchProps({ placeholder: next })}
            />
          </Field>
          <Field label="形状">
            <SelectInput
              value={String(props.shape ?? 'capsule') as 'capsule' | 'rounded' | 'square'}
              options={[
                { value: 'capsule', label: '胶囊' },
                { value: 'rounded', label: '圆角' },
                { value: 'square', label: '直角' },
              ]}
              onChange={(next) => patchProps({ shape: next })}
            />
          </Field>
          <Field label="背景色">
            <ColorInput
              value={String(props.bgColor ?? '')}
              fallback={tokens.color.surface}
              onChange={(next) => patchProps({ bgColor: next })}
            />
          </Field>
          <Field label="文字颜色">
            <ColorInput
              value={String(props.textColor ?? '')}
              fallback={tokens.color.ink3}
              onChange={(next) => patchProps({ textColor: next })}
            />
          </Field>
          <CheckInput
            checked={props.showHotwords === true}
            label="显示热词"
            onChange={(next) => patchProps({ showHotwords: next })}
          />
          {props.showHotwords === true && (
            <Field label="热词（逗号分隔，最多 6 个）">
              <TextInput
                value={strings(props.hotwords).join(',')}
                onChange={(next) =>
                  patchProps({
                    hotwords: next
                      .split(/[,，]/)
                      .map((item) => item.trim())
                      .filter(Boolean)
                      .slice(0, 6),
                  })
                }
              />
            </Field>
          )}
          <LinkField
            label="点击跳转"
            value={props.link as MicroLink | undefined}
            onChange={(link) => patchProps({ link })}
          />
        </>
      )}

      {component.type === 'banner' && (
        <>
          <div className="micro-item-list">
            {records(props.items).map((item, index) => (
              <div key={index} className="micro-item-card">
                <div className="row-between">
                  <strong className="small">图片 {index + 1}</strong>
                  <div className="row" style={{ gap: 4 }}>
                    <Button size="sm" variant="plain" onClick={() => moveItem(index, -1)}>
                      上移
                    </Button>
                    <Button size="sm" variant="plain" onClick={() => moveItem(index, 1)}>
                      下移
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => removeItem(index)}>
                      删除
                    </Button>
                  </div>
                </div>
                <AssetPicker
                  value={String(item.imageKey ?? '')}
                  onChange={(key) => updateItem(index, { imageKey: key })}
                />
                <Field label="标题（选填）">
                  <TextInput
                    value={String(item.title ?? '')}
                    maxLength={40}
                    onChange={(next) => updateItem(index, { title: next })}
                  />
                </Field>
                <LinkField
                  value={item.link as MicroLink | undefined}
                  onChange={(link) => updateItem(index, { link })}
                />
              </div>
            ))}
            {records(props.items).length < MICRO_PAGE_LIMITS.maxBannerItems && (
              <Button size="sm" variant="ghost" onClick={addBanner}>
                添加图片
              </Button>
            )}
          </div>
          <Field label="高度比">
            <SelectInput
              value={String(props.ratio ?? '2:1') as '16:9' | '4:3' | '3:2' | '2:1'}
              options={[
                { value: '16:9', label: '16:9' },
                { value: '4:3', label: '4:3' },
                { value: '3:2', label: '3:2' },
                { value: '2:1', label: '2:1' },
              ]}
              onChange={(next) => patchProps({ ratio: next })}
            />
          </Field>
          <div className="row" style={{ gap: 16 }}>
            <CheckInput
              checked={props.autoplay !== false}
              label="自动播放"
              onChange={(next) => patchProps({ autoplay: next })}
            />
            <Field label="间隔（秒）">
              <NumberInput
                value={Number(props.interval ?? 4)}
                min={2}
                max={10}
                onChange={(next) => patchProps({ interval: next })}
              />
            </Field>
          </div>
          <Field label="指示器">
            <SelectInput
              value={String(props.indicator ?? 'dots') as 'dots' | 'none'}
              options={[
                { value: 'dots', label: '圆点' },
                { value: 'none', label: '隐藏' },
              ]}
              onChange={(next) => patchProps({ indicator: next })}
            />
          </Field>
        </>
      )}

      {component.type === 'imageHotspot' && (
        <>
          <AssetPicker
            value={String(props.imageKey ?? '')}
            onChange={(key) => patchProps({ imageKey: key })}
            hint="整张热区底图"
          />
          <Field label="替代文案">
            <TextInput
              value={String(props.alt ?? '')}
              maxLength={40}
              onChange={(next) => patchProps({ alt: next })}
            />
          </Field>
          <div className="micro-item-list">
            {records(props.hotspots).map((spot, index) => (
              <div key={index} className="micro-item-card">
                <div className="row-between">
                  <strong className="small">热区 {index + 1}</strong>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      patchProps({ hotspots: records(props.hotspots).filter((_, i) => i !== index) })
                    }
                  >
                    删除
                  </Button>
                </div>
                <div className="micro-coord-grid">
                  {(['x', 'y', 'w', 'h'] as const).map((field) => (
                    <Field key={field} label={field.toUpperCase()}>
                      <NumberInput
                        value={Number(spot[field] ?? (field === 'w' || field === 'h' ? 20 : 0))}
                        min={0}
                        max={100}
                        onChange={(next) => updateHotspot(index, { [field]: next })}
                      />
                    </Field>
                  ))}
                </div>
                <LinkField
                  value={spot.link as MicroLink | undefined}
                  onChange={(link) => updateHotspot(index, { link })}
                />
              </div>
            ))}
            {records(props.hotspots).length < MICRO_PAGE_LIMITS.maxHotspots && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  patchProps({
                    hotspots: [
                      ...records(props.hotspots),
                      { x: 10, y: 10, w: 30, h: 20, link: { type: 'none', value: null } },
                    ],
                  })
                }
              >
                添加热区
              </Button>
            )}
          </div>
        </>
      )}

      {component.type === 'goods' && (
        <>
          <Field label="数据来源">
            <SelectInput
              value={String(props.source ?? 'picks') as (typeof MICRO_GOODS_SOURCES)[number]}
              options={[
                { value: 'manual', label: '手动选择商品' },
                { value: 'category', label: '按分类' },
                { value: 'seckill', label: '秒杀活动' },
                { value: 'picks', label: '精选（系统兜底）' },
              ]}
              onChange={(next) => patchProps({ source: next })}
            />
          </Field>
          {props.source === 'manual' && (
            <Field label={`选择商品（已选 ${manualIds.length}）`}>
              <input
                className="input"
                placeholder="搜索商品名称"
                value={productKeyword}
                onChange={(event) => setProductKeyword(event.target.value)}
              />
              <div className="micro-product-list">
                {filteredProducts.map((product) => {
                  const checked = manualIds.includes(product.id);
                  return (
                    <label key={product.id} className="micro-product-row">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? manualIds.filter((id) => id !== product.id)
                            : [...manualIds, product.id].slice(0, MICRO_PAGE_LIMITS.maxGoods);
                          patchProps({ productIds: next });
                        }}
                      />
                      {product.mainImageKey ? (
                        <img src={assetPreviewUrl(product.mainImageKey)} alt="" />
                      ) : (
                        <span className="micro-product-ph">{product.title.slice(0, 1)}</span>
                      )}
                      <span className="grow">{product.title}</span>
                    </label>
                  );
                })}
                {!filteredProducts.length && <span className="muted small">没有匹配的在售商品</span>}
              </div>
            </Field>
          )}
          {props.source === 'category' && (
            <Field label="分类">
              <select
                className="input"
                value={String(props.categoryId ?? '')}
                onChange={(event) => patchProps({ categoryId: event.target.value })}
              >
                <option value="">请选择分类</option>
                {categories.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {props.source === 'seckill' && (
            <Field label="秒杀活动（留空表示进行中的全部）">
              <select
                className="input"
                value={String(props.promotionId ?? '')}
                onChange={(event) => patchProps({ promotionId: event.target.value })}
              >
                <option value="">全部进行中活动</option>
                {seckills.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="展示数量">
            <NumberInput
              value={Number(props.limit ?? 6)}
              min={1}
              max={MICRO_PAGE_LIMITS.maxGoods}
              onChange={(next) => patchProps({ limit: next })}
            />
          </Field>
          <Field label="列表样式">
            <SelectInput
              value={String(props.layout ?? 'grid-2') as (typeof MICRO_GOODS_LAYOUTS)[number]}
              options={[
                { value: 'grid-2', label: '一行两个' },
                { value: 'grid-3', label: '一行三个' },
                { value: 'list', label: '详细列表' },
                { value: 'scroll-x', label: '横向滑动' },
              ]}
              onChange={(next) => patchProps({ layout: next })}
            />
          </Field>
          <div className="micro-check-grid">
            <CheckInput
              checked={show.price !== false}
              label="价格"
              onChange={(next) => patchProps({ show: { ...show, price: next } })}
            />
            <CheckInput
              checked={show.originPrice !== false}
              label="划线价"
              onChange={(next) => patchProps({ show: { ...show, originPrice: next } })}
            />
            <CheckInput
              checked={show.sales === true}
              label="销量"
              onChange={(next) => patchProps({ show: { ...show, sales: next } })}
            />
            <CheckInput
              checked={show.tag === true}
              label="角标"
              onChange={(next) => patchProps({ show: { ...show, tag: next } })}
            />
          </div>
          <CheckInput
            checked={props.buyButton === true}
            label="显示购买按钮"
            onChange={(next) => patchProps({ buyButton: next })}
          />
        </>
      )}

      {component.type === 'divider' && (
        <>
          <Field label="线型">
            <SelectInput
              value={String(props.style ?? 'solid') as 'solid' | 'dashed' | 'dotted'}
              options={[
                { value: 'solid', label: '实线' },
                { value: 'dashed', label: '虚线' },
                { value: 'dotted', label: '点线' },
              ]}
              onChange={(next) => patchProps({ style: next })}
            />
          </Field>
          <Field label="颜色">
            <ColorInput
              value={String(props.color ?? tokens.color.line2)}
              onChange={(next) => patchProps({ color: next })}
            />
          </Field>
          <Field label="粗细（px）">
            <NumberInput
              value={Number(props.thickness ?? 1)}
              min={1}
              max={8}
              onChange={(next) => patchProps({ thickness: next })}
            />
          </Field>
          <Field label="上下间距（px）">
            <NumberInput
              value={Number(props.spacing ?? 12)}
              min={0}
              max={40}
              onChange={(next) => patchProps({ spacing: next })}
            />
          </Field>
        </>
      )}

      {component.type === 'video' && (
        <>
          <AssetPicker
            kind="video"
            value={String(props.videoKey ?? '')}
            onChange={(key) => patchProps({ videoKey: key })}
            hint="mp4 / mov / webm，≤50MB"
          />
          <AssetPicker
            value={String(props.coverKey ?? '')}
            onChange={(key) => patchProps({ coverKey: key })}
            hint="视频封面（必填）"
          />
          <Field label="宽高比">
            <SelectInput
              value={String(props.ratio ?? '16:9') as '16:9' | '4:3' | '1:1'}
              options={[
                { value: '16:9', label: '16:9' },
                { value: '4:3', label: '4:3' },
                { value: '1:1', label: '1:1' },
              ]}
              onChange={(next) => patchProps({ ratio: next })}
            />
          </Field>
          <div className="micro-check-grid">
            <CheckInput
              checked={props.autoplay === true}
              label="自动播放"
              onChange={(next) => patchProps({ autoplay: next })}
            />
            <CheckInput
              checked={props.loop === true}
              label="循环"
              onChange={(next) => patchProps({ loop: next })}
            />
            <CheckInput
              checked={props.muted !== false}
              label="静音"
              onChange={(next) => patchProps({ muted: next })}
            />
          </div>
        </>
      )}

      {component.type === 'text' && (
        <>
          <Field label="文案" required>
            <textarea
              className="input micro-textarea"
              maxLength={MICRO_PAGE_LIMITS.maxTextLength}
              value={String(props.content ?? '')}
              onChange={(event) => patchProps({ content: event.target.value })}
            />
          </Field>
          <div className="micro-coord-grid">
            <Field label="字号">
              <NumberInput
                value={Number(props.fontSize ?? 14)}
                min={12}
                max={32}
                onChange={(next) => patchProps({ fontSize: next })}
              />
            </Field>
            <Field label="行高">
              <NumberInput
                value={Number(props.lineHeight ?? 1.5)}
                min={1}
                max={2.5}
                step={0.1}
                onChange={(next) => patchProps({ lineHeight: next })}
              />
            </Field>
          </div>
          <Field label="颜色">
            <ColorInput
              value={String(props.color ?? tokens.color.ink)}
              onChange={(next) => patchProps({ color: next })}
            />
          </Field>
          <Field label="字重 / 对齐">
            <div className="row" style={{ gap: 8 }}>
              <SelectInput
                value={String(props.weight ?? 'normal') as 'normal' | 'bold'}
                options={[
                  { value: 'normal', label: '常规' },
                  { value: 'bold', label: '加粗' },
                ]}
                onChange={(next) => patchProps({ weight: next })}
              />
              <SelectInput
                value={String(props.align ?? 'left') as 'left' | 'center' | 'right'}
                options={[
                  { value: 'left', label: '左对齐' },
                  { value: 'center', label: '居中' },
                  { value: 'right', label: '右对齐' },
                ]}
                onChange={(next) => patchProps({ align: next })}
              />
            </div>
          </Field>
          <Field label="最大行数（0 不限制）">
            <NumberInput
              value={Number(props.maxLines ?? 0)}
              min={0}
              max={10}
              onChange={(next) => patchProps({ maxLines: next })}
            />
          </Field>
          <LinkField
            value={props.link as MicroLink | undefined}
            onChange={(link) => patchProps({ link })}
          />
        </>
      )}

      {component.type === 'navGrid' && (
        <>
          <div className="micro-item-list">
            {records(props.items).map((item, index) => (
              <div key={index} className="micro-item-card">
                <div className="row-between">
                  <strong className="small">入口 {index + 1}</strong>
                  <div className="row" style={{ gap: 4 }}>
                    <Button size="sm" variant="plain" onClick={() => moveItem(index, -1)}>
                      上移
                    </Button>
                    <Button size="sm" variant="plain" onClick={() => moveItem(index, 1)}>
                      下移
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => removeItem(index)}>
                      删除
                    </Button>
                  </div>
                </div>
                <Field label="入口名称">
                  <TextInput
                    value={String(item.name ?? '')}
                    maxLength={6}
                    onChange={(next) => updateItem(index, { name: next })}
                  />
                </Field>
                <AssetPicker
                  value={String(item.iconKey ?? '')}
                  onChange={(key) => updateItem(index, { iconKey: key })}
                  hint="图标（选填，建议方形）"
                />
                <LinkField
                  value={item.link as MicroLink | undefined}
                  onChange={(link) => updateItem(index, { link })}
                />
              </div>
            ))}
            {records(props.items).length < MICRO_PAGE_LIMITS.maxNavItems && (
              <Button size="sm" variant="ghost" onClick={addNav}>
                添加入口
              </Button>
            )}
          </div>
          <Field label="每行数量">
            <SelectInput
              value={String(props.columns ?? 4) as '4' | '5'}
              options={[
                { value: '4', label: '一行 4 个' },
                { value: '5', label: '一行 5 个' },
              ]}
              onChange={(next) => patchProps({ columns: Number(next) })}
            />
          </Field>
          <Field label="图标形状">
            <SelectInput
              value={String(props.iconShape ?? 'circle') as 'circle' | 'square'}
              options={[
                { value: 'circle', label: '圆形' },
                { value: 'square', label: '方形' },
              ]}
              onChange={(next) => patchProps({ iconShape: next })}
            />
          </Field>
          <Field label="文字颜色">
            <ColorInput
              value={String(props.textColor ?? '')}
              fallback={tokens.color.ink}
              onChange={(next) => patchProps({ textColor: next })}
            />
          </Field>
          <Field label="字号">
            <NumberInput
              value={Number(props.fontSize ?? 12)}
              min={10}
              max={16}
              onChange={(next) => patchProps({ fontSize: next })}
            />
          </Field>
        </>
      )}

      <hr className="micro-divider" />
      <strong className="small">通用样式</strong>
      <StyleFields style={component.style ?? {}} onChange={patchStyle} />
    </div>
  );
}
