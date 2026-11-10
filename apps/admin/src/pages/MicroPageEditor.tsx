import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { tokens } from '@shanye/tokens';
import {
  MICRO_COMPONENT_LABELS,
  MICRO_COMPONENT_TYPES,
  type MicroComponent,
  type MicroComponentType,
  type MicroPageSettings,
} from '@shanye/shared/src/microPage';

import { api, ApiError } from '../api/client';
import {
  getMicroPage,
  publishMicroPage,
  rollbackMicroPage,
  saveMicroPage,
  type MicroPageDetail,
} from '../api/microPages';
import { AssetPicker } from '../components/AssetPicker';
import { ComponentInspector } from '../components/microPage/Inspector';
import { MicroComponentPreview, type PreviewProduct } from '../components/microPage/Preview';
import { ColorInput, SelectInput, TextInput } from '../components/microPage/fields';
import { Button, Confirm, Field, Modal, PageHeader, Tag } from '../components/ui';
import { toast } from '../components/toast';

const EMPTY_SETTINGS: MicroPageSettings = {
  shareTitle: '',
  shareDesc: '',
  shareImageKey: '',
  bgColor: '',
  navTitle: '',
  navColor: 'black',
  allowShare: true,
};

function newId(): string {
  return `cmp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function createComponent(type: MicroComponentType): MicroComponent {
  const base = {
    id: newId(),
    type,
    visible: true,
    style: { margin: [0, 0, 0, 0], padding: [0, 0, 0, 0], bgColor: '', radius: 0 },
  };
  switch (type) {
    case 'notice':
      return {
        ...base,
        props: { text: '新客专享 · 全场包邮', tag: '公告', scroll: true, speed: 80, textColor: '', bgColor: '', link: { type: 'none', value: null } },
      };
    case 'search':
      return {
        ...base,
        props: { placeholder: '搜索山野好物', shape: 'capsule', bgColor: '', textColor: '', showHotwords: false, hotwords: [], link: { type: 'none', value: null } },
      };
    case 'banner':
      return { ...base, props: { items: [], ratio: '2:1', autoplay: true, interval: 4, indicator: 'dots' } };
    case 'imageHotspot':
      return { ...base, props: { imageKey: '', alt: '', hotspots: [] } };
    case 'goods':
      return {
        ...base,
        props: {
          source: 'picks',
          productIds: [],
          categoryId: '',
          promotionId: '',
          limit: 6,
          layout: 'grid-2',
          show: { price: true, originPrice: true, sales: false, tag: false },
          buyButton: false,
          cardBg: '',
        },
      };
    case 'divider':
      return { ...base, props: { style: 'solid', color: tokens.color.line2, thickness: 1, spacing: 12 } };
    case 'video':
      return { ...base, props: { videoKey: '', coverKey: '', ratio: '16:9', autoplay: false, loop: false, muted: true } };
    case 'text':
      return {
        ...base,
        props: { content: '在这里输入文本', fontSize: 14, color: tokens.color.ink, weight: 'normal', align: 'left', lineHeight: 1.5, maxLines: 0, link: { type: 'none', value: null } },
      };
    case 'navGrid':
      return { ...base, props: { columns: 4, iconShape: 'circle', textColor: '', fontSize: 12, items: [] } };
    default:
      return { ...base, props: {} };
  }
}

export default function MicroPageEditor() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState<MicroPageDetail | null>(null);
  const [title, setTitle] = useState('');
  const [components, setComponents] = useState<MicroComponent[]>([]);
  const [settings, setSettings] = useState<MicroPageSettings>({ ...EMPTY_SETTINGS });
  const [selectedId, setSelectedId] = useState('');
  const [products, setProducts] = useState<PreviewProduct[]>([]);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [publishing, setPublishing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const updatedAtRef = useRef('');
  const skipAutosave = useRef(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const [detail, productResult] = await Promise.all([
          getMicroPage(id),
          api<{ items: { id: string; title: string; priceMinCents: number; mainImageKey: string | null }[] }>(
            '/admin/products',
            { query: { pageSize: 100 } },
          ),
        ]);
        if (!alive) return;
        setPage(detail);
        setTitle(detail.title);
        setComponents(detail.components);
        setSettings({ ...EMPTY_SETTINGS, ...detail.settings });
        updatedAtRef.current = detail.updatedAt;
        setProducts(
          productResult.items.map((item) => ({
            id: item.id,
            title: item.title,
            priceMinCents: item.priceMinCents,
            mainImageKey: item.mainImageKey,
          })),
        );
        skipAutosave.current = true;
      } catch (err) {
        toast(err instanceof Error ? err.message : '页面加载失败', 'error');
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [id]);

  const selected = useMemo(
    () => components.find((component) => component.id === selectedId) ?? null,
    [components, selectedId],
  );

  async function persist(showToast = false): Promise<boolean> {
    if (!page) return false;
    setStatus('saving');
    try {
      const result = await saveMicroPage(page.id, {
        title,
        components,
        settings,
        expectedUpdatedAt: updatedAtRef.current,
      });
      updatedAtRef.current = result.updatedAt;
      setStatus('saved');
      if (showToast) toast('草稿已保存');
      return true;
    } catch (err) {
      setStatus('error');
      toast(
        err instanceof ApiError ? err.message : '保存失败，请检查组件配置',
        'error',
      );
      return false;
    }
  }

  // 草稿自动保存：改动后 800ms 合并提交，避免每敲一个字都请求
  useEffect(() => {
    if (!page || loading) return;
    if (skipAutosave.current) {
      skipAutosave.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void persist();
    }, 800);
    return () => clearTimeout(timer);
  }, [components, settings, title, page, loading]);

  async function publish() {
    setPublishing(true);
    try {
      const saved = await persist();
      if (!saved) return;
      const result = await publishMicroPage(id);
      setPage(result);
      setComponents(result.components);
      setSettings({ ...EMPTY_SETTINGS, ...result.settings });
      updatedAtRef.current = result.updatedAt;
      toast('已上线，预计 1 分钟内生效');
    } catch (err) {
      toast(err instanceof Error ? err.message : '上线失败', 'error');
    } finally {
      setPublishing(false);
    }
  }

  async function rollback() {
    try {
      const result = await rollbackMicroPage(id);
      setPage(result);
      setComponents(result.components);
      setSettings({ ...EMPTY_SETTINGS, ...result.settings });
      updatedAtRef.current = result.updatedAt;
      toast('已回滚到上一版');
    } catch (err) {
      toast(err instanceof Error ? err.message : '回滚失败', 'error');
    } finally {
      setRollbackOpen(false);
    }
  }

  function addComponent(type: MicroComponentType) {
    const next = createComponent(type);
    setComponents((prev) => [...prev, next]);
    setSelectedId(next.id);
  }

  function updateComponent(next: MicroComponent) {
    setComponents((prev) => prev.map((item) => (item.id === next.id ? next : item)));
  }

  function moveComponent(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= components.length) return;
    const next = [...components];
    [next[index], next[target]] = [next[target], next[index]];
    setComponents(next);
  }

  function duplicateComponent(index: number) {
    const source = components[index];
    const copy: MicroComponent = {
      ...source,
      id: newId(),
      props: JSON.parse(JSON.stringify(source.props ?? {})),
      style: { ...source.style },
    };
    const next = [...components];
    next.splice(index + 1, 0, copy);
    setComponents(next);
    setSelectedId(copy.id);
  }

  function removeComponent(index: number) {
    const target = components[index];
    setComponents((prev) => prev.filter((_, i) => i !== index));
    if (selectedId === target.id) setSelectedId('');
  }

  if (loading) {
    return (
      <>
        <PageHeader title="页面装修" />
        <div className="table-loading">加载中…</div>
      </>
    );
  }

  if (!page) {
    return (
      <>
        <PageHeader title="页面装修" />
        <div className="empty">页面不存在或已被删除</div>
      </>
    );
  }

  const saveLabel =
    status === 'saving' ? '保存中…' : status === 'error' ? '保存失败' : status === 'saved' ? '已保存' : '未修改';

  return (
    <>
      <style>{editorStyles}</style>
      <div className="micro-editor-bar">
        <div className="row" style={{ gap: 10 }}>
          <Link className="micro-back" to="/settings/home">
            ← 返回
          </Link>
          <strong>{title}</strong>
          <Tag tone={page.status === 'PUBLISHED' ? 'ok' : 'muted'}>
            {page.status === 'PUBLISHED' ? `已上线 v${page.version}` : '草稿'}
          </Tag>
          {page.isHome && <Tag tone="brand">首页</Tag>}
          <span className={`micro-save-status micro-save-${status}`}>{saveLabel}</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button variant="plain" size="sm" onClick={() => setSettingsOpen(true)}>
            页面设置
          </Button>
          {page.published && (
            <Button variant="ghost" size="sm" onClick={() => setRollbackOpen(true)}>
              回滚上一版
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void persist(true)}>
            保存草稿
          </Button>
          <Button size="sm" loading={publishing} onClick={() => void publish()}>
            上线
          </Button>
        </div>
      </div>

      <div className="micro-editor">
        <aside className="micro-lib">
          <h4>基础组件</h4>
          {MICRO_COMPONENT_TYPES.map((type) => (
            <button key={type} type="button" className="micro-lib-item" onClick={() => addComponent(type)}>
              <span className="micro-lib-plus">＋</span>
              {MICRO_COMPONENT_LABELS[type]}
            </button>
          ))}
          <p className="small muted">点击组件添加到页面底部</p>
        </aside>

        <div className="micro-canvas-wrap" onClick={() => setSelectedId('')}>
          <div
            className="micro-canvas"
            style={{ background: settings.bgColor || tokens.color.canvas }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="micro-canvas-nav" style={{ color: settings.navColor === 'white' ? tokens.color.surface : tokens.color.ink }}>
              {settings.navTitle || title}
            </div>
            {!components.length && (
              <div className="micro-empty">
                <strong>页面还是空的</strong>
                <span>从左侧点击组件开始搭建</span>
              </div>
            )}
            {components.map((component, index) => (
              <div
                key={component.id}
                className={`micro-comp${component.id === selectedId ? ' on' : ''}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedId(component.id);
                }}
              >
                <MicroComponentPreview component={component} products={products} />
                {component.id === selectedId && (
                  <div className="micro-comp-tools">
                    <button type="button" title="上移" onClick={() => moveComponent(index, -1)}>
                      ↑
                    </button>
                    <button type="button" title="下移" onClick={() => moveComponent(index, 1)}>
                      ↓
                    </button>
                    <button type="button" title="复制" onClick={() => duplicateComponent(index)}>
                      ⧉
                    </button>
                    <button
                      type="button"
                      title={component.visible ? '隐藏' : '显示'}
                      onClick={() => updateComponent({ ...component, visible: !component.visible })}
                    >
                      {component.visible ? '◉' : '◎'}
                    </button>
                    <button type="button" title="删除" onClick={() => removeComponent(index)}>
                      ×
                    </button>
                  </div>
                )}
                <span className="micro-comp-label">
                  {MICRO_COMPONENT_LABELS[component.type as keyof typeof MICRO_COMPONENT_LABELS] ?? component.type}
                </span>
              </div>
            ))}
          </div>
        </div>

        <aside className="micro-inspector-wrap">
          {selected ? (
            <ComponentInspector component={selected} products={products} onChange={updateComponent} />
          ) : (
            <div className="micro-inspector-empty">
              <strong>未选中组件</strong>
              <span>点击画布中的组件，在这里调整属性</span>
            </div>
          )}
        </aside>
      </div>

      <Modal
        open={settingsOpen}
        title="页面设置"
        wide
        onClose={() => setSettingsOpen(false)}
        footer={
          <Button type="button" onClick={() => setSettingsOpen(false)}>
            完成
          </Button>
        }
      >
        <div className="grid grid-2">
          <Field label="页面名称" required>
            <TextInput value={title} maxLength={20} onChange={setTitle} />
          </Field>
          <Field label="页面标识" hint="小程序路径 /pages/micro/index?code=...">
            <input className="input" value={page.code} readOnly />
          </Field>
          <Field label="分享标题" hint="为空时使用页面名称">
            <TextInput
              value={settings.shareTitle ?? ''}
              maxLength={40}
              onChange={(next) => setSettings({ ...settings, shareTitle: next })}
            />
          </Field>
          <Field label="分享描述">
            <TextInput
              value={settings.shareDesc ?? ''}
              maxLength={80}
              onChange={(next) => setSettings({ ...settings, shareDesc: next })}
            />
          </Field>
          <Field label="导航栏标题">
            <TextInput
              value={settings.navTitle ?? ''}
              maxLength={20}
              onChange={(next) => setSettings({ ...settings, navTitle: next })}
            />
          </Field>
          <Field label="导航栏文字颜色">
            <SelectInput
              value={settings.navColor ?? 'black'}
              options={[
                { value: 'black', label: '黑色' },
                { value: 'white', label: '白色' },
              ]}
              onChange={(next) => setSettings({ ...settings, navColor: next })}
            />
          </Field>
          <Field label="页面背景色">
            <ColorInput
              value={settings.bgColor ?? ''}
              fallback={tokens.color.canvas}
              onChange={(next) => setSettings({ ...settings, bgColor: next })}
            />
          </Field>
          <Field label="分享图" hint="建议 5:4，展示在分享卡片">
            <AssetPicker
              value={settings.shareImageKey ?? ''}
              onChange={(key) => setSettings({ ...settings, shareImageKey: key })}
            />
          </Field>
        </div>
        <label className="row small" style={{ gap: 8, marginTop: 12 }}>
          <input
            type="checkbox"
            checked={settings.allowShare !== false}
            onChange={(event) => setSettings({ ...settings, allowShare: event.target.checked })}
          />
          允许分享该页面
        </label>
      </Modal>

      <Confirm
        open={rollbackOpen}
        title="回滚到上一版"
        text="线上页面会立即恢复为上一次发布的版本，当前发布内容将被替换。"
        confirmText="确认回滚"
        onConfirm={() => void rollback()}
        onCancel={() => setRollbackOpen(false)}
      />

      <div className="micro-footer">
        <Button
          variant="ghost"
          onClick={() => {
            void persist();
            navigate('/settings/home');
          }}
        >
          保存并返回
        </Button>
      </div>
    </>
  );
}

const editorStyles = `
.micro-editor-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.micro-back { color: var(--text-muted); font-size: 13px; text-decoration: none; }
.micro-back:hover { color: var(--brand); }
.micro-save-status { font-size: 12px; color: var(--text-muted); }
.micro-save-saving { color: var(--brand); }
.micro-save-error { color: var(--danger, #b3261e); }
.micro-editor { display: grid; grid-template-columns: 168px minmax(340px, 1fr) 340px; gap: 14px; align-items: start; }
.micro-lib { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; position: sticky; top: 12px; }
.micro-lib h4 { margin: 0 0 10px; font-size: 13px; }
.micro-lib-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; margin-bottom: 6px; border: 1px solid var(--line); background: var(--surface); border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; text-align: left; }
.micro-lib-item:hover { border-color: var(--brand); color: var(--brand); }
.micro-lib-plus { font-weight: 700; }
.micro-canvas-wrap { display: flex; justify-content: center; padding: 4px 0 40px; }
.micro-canvas { width: 375px; min-height: 640px; border-radius: 22px; border: 1px solid var(--line); box-shadow: 0 18px 40px rgba(30, 24, 16, 0.12); overflow: hidden; position: relative; }
.micro-canvas-nav { text-align: center; padding: 12px 0 10px; font-size: 14px; font-weight: 600; }
.micro-empty { padding: 120px 24px; text-align: center; color: var(--text-muted); display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.micro-comp { position: relative; outline: 1px dashed transparent; }
.micro-comp:hover { outline-color: rgba(47, 111, 78, 0.4); }
.micro-comp.on { outline: 2px solid var(--brand); }
.micro-comp-tools { position: absolute; right: 4px; top: 4px; display: flex; gap: 2px; background: var(--brand); border-radius: 6px; padding: 2px; z-index: 5; }
.micro-comp-tools button { border: none; background: transparent; color: #fff; width: 22px; height: 22px; cursor: pointer; font-size: 13px; border-radius: 4px; }
.micro-comp-tools button:hover { background: rgba(255,255,255,0.2); }
.micro-comp-label { position: absolute; left: 4px; top: 4px; background: rgba(0,0,0,0.45); color: #fff; font-size: 10px; padding: 1px 5px; border-radius: 4px; opacity: 0; }
.micro-comp:hover .micro-comp-label { opacity: 1; }
.micro-inspector-wrap { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); min-height: 320px; position: sticky; top: 12px; max-height: calc(100vh - 120px); overflow-y: auto; }
.micro-inspector { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.micro-inspector-head { display: flex; align-items: center; justify-content: space-between; }
.micro-inspector-empty { padding: 60px 20px; text-align: center; color: var(--text-muted); display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.micro-subfield { display: flex; flex-direction: column; gap: 6px; }
.micro-item-list { display: flex; flex-direction: column; gap: 8px; }
.micro-item-card { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.micro-textarea { min-height: 72px; resize: vertical; font-family: inherit; }
.micro-coord-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.micro-style-grid { display: flex; flex-direction: column; gap: 8px; }
.micro-style-row { display: grid; grid-template-columns: 52px repeat(4, minmax(0, 1fr)); gap: 4px; align-items: center; font-size: 12px; }
.micro-check-grid { display: flex; flex-wrap: wrap; gap: 10px; }
.micro-divider { border: none; border-top: 1px solid var(--line); margin: 6px 0; }
.micro-color { width: 40px; height: 34px; padding: 0; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.micro-product-list { max-height: 220px; overflow-y: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 6px; display: flex; flex-direction: column; gap: 2px; }
.micro-product-row { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 3px 4px; border-radius: 4px; cursor: pointer; }
.micro-product-row:hover { background: var(--surface-2); }
.micro-product-row img, .micro-product-ph { width: 26px; height: 26px; border-radius: 4px; object-fit: cover; background: var(--surface-2); display: inline-flex; align-items: center; justify-content: center; }
.micro-link-field { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.micro-footer { display: flex; justify-content: flex-end; margin-top: 16px; }
.micro-notice { display: flex; align-items: center; gap: 6px; padding: 8px 12px; font-size: 12px; background: #fff7e8; border-radius: 6px; }
.micro-notice-tag { background: var(--brand); color: #fff; border-radius: 3px; padding: 1px 4px; font-size: 10px; }
.micro-search { display: flex; align-items: center; gap: 6px; padding: 8px 12px; font-size: 12px; }
.micro-banner { position: relative; width: 100%; background: #e7e2d8; overflow: hidden; border-radius: 8px; }
.micro-banner img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.micro-banner > span, .micro-video > span { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #9b9488; font-size: 12px; }
.micro-badge { position: absolute; right: 8px; bottom: 8px; background: rgba(0,0,0,0.5); color: #fff; font-size: 10px; padding: 1px 5px; border-radius: 6px; font-style: normal; }
.micro-hotspot { position: relative; background: #e7e2d8; border-radius: 8px; overflow: hidden; min-height: 120px; }
.micro-hotspot img { display: block; width: 100%; }
.micro-hotspot > span { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #9b9488; font-size: 12px; }
.micro-hotspot i { position: absolute; border: 1px dashed #fff; background: rgba(47,111,78,0.25); color: #fff; font-size: 10px; font-style: normal; display: flex; align-items: center; justify-content: center; }
.micro-goods-hint { font-size: 11px; color: var(--text-muted); margin-bottom: 6px; }
.micro-goods-card { background: #fff; border-radius: 8px; overflow: hidden; padding: 6px; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.micro-goods-card img, .micro-goods-ph { width: 100%; height: 96px; object-fit: cover; border-radius: 6px; background: var(--surface-2); display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 11px; }
.micro-goods-card strong { font-size: 12px; font-weight: 500; }
.micro-goods-card em { font-style: normal; color: #b3261e; font-weight: 600; }
.micro-video { position: relative; width: 100%; background: #111; border-radius: 8px; overflow: hidden; }
.micro-video video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.micro-nav { display: grid; gap: 10px; padding: 10px 8px; }
.micro-nav-item { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 12px; }
.micro-nav-item img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; background: #fff; }
.micro-nav-ph { width: 40px; height: 40px; border-radius: 50%; background: var(--brand-soft); color: var(--brand); display: flex; align-items: center; justify-content: center; font-size: 13px; }
.micro-nav-item em { font-style: normal; }
.micro-preview-hidden { padding: 6px 12px; font-size: 11px; color: var(--text-muted); background: repeating-linear-gradient(45deg, #f4f1ea, #f4f1ea 6px, #efeae0 6px, #efeae0 12px); }
.micro-preview-unknown { padding: 10px; font-size: 12px; color: var(--text-muted); }
@media (max-width: 1280px) {
  .micro-editor { grid-template-columns: 140px minmax(320px, 1fr) 300px; }
}
`;
