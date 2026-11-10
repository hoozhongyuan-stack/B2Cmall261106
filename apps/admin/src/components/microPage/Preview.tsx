import { MICRO_BANNER_RATIOS, MICRO_COMPONENT_LABELS, type MicroComponent } from '@shanye/shared/src/microPage';

import { tokens } from '@shanye/tokens';
import { assetPreviewUrl } from '../../api/assets';

export interface PreviewProduct {
  id: string;
  title: string;
  priceMinCents: number;
  mainImageKey: string | null;
}

const RATIO_PERCENT: Record<string, string> = {
  '16:9': '56.25%',
  '4:3': '75%',
  '3:2': '66.67%',
  '2:1': '50%',
  '1:1': '100%',
};

function asProps(component: MicroComponent): Record<string, unknown> {
  return (component.props ?? {}) as Record<string, unknown>;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function boxStyle(component: MicroComponent) {
  const style = component.style ?? {};
  const margin = style.margin ?? [0, 0, 0, 0];
  const padding = style.padding ?? [0, 0, 0, 0];
  const [mt = 0, mr = 0, mb = 0, ml = 0] = margin;
  const [pt = 0, pr = 0, pb = 0, pl = 0] = padding;
  return {
    margin: `${mt}px ${mr}px ${mb}px ${ml}px`,
    padding: `${pt}px ${pr}px ${pb}px ${pl}px`,
    background: style.bgColor || undefined,
    borderRadius: style.radius ? `${style.radius}px` : undefined,
  };
}

function GoodsPreview({
  component,
  products,
}: {
  component: MicroComponent;
  products: PreviewProduct[];
}) {
  const props = asProps(component);
  const source = String(props.source ?? 'picks');
  const limit = Number(props.limit ?? 6);
  const layout = String(props.layout ?? 'grid-2');
  const manualIds = strings(props.productIds);
  const picked = manualIds
    .map((id) => products.find((product) => product.id === id))
    .filter((product): product is PreviewProduct => Boolean(product));

  const tiles =
    source === 'manual' && picked.length
      ? picked
      : Array.from({ length: Math.min(limit, 6) }, (_, index) => ({
          id: `placeholder-${index}`,
          title: '',
          priceMinCents: 0,
          mainImageKey: null,
        }));

  const sourceLabel =
    source === 'manual'
      ? `手动选品 ${manualIds.length} 个`
      : source === 'category'
        ? '按分类实时取数'
        : source === 'seckill'
          ? '秒杀活动实时取数'
          : '精选商品实时取数';
  const columns = layout === 'grid-3' ? 3 : layout === 'grid-2' ? 2 : 1;

  return (
    <div>
      <div className="micro-goods-hint">{sourceLabel}</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: 8,
        }}
      >
        {tiles.map((product) => (
          <div key={product.id} className="micro-goods-card">
            {product.mainImageKey ? (
              <img src={assetPreviewUrl(product.mainImageKey)} alt="" />
            ) : (
              <span className="micro-goods-ph">商品</span>
            )}
            <strong>{product.title || '商品名称'}</strong>
            <em>{product.priceMinCents ? `¥${(product.priceMinCents / 100).toFixed(2)}` : '¥--'}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MicroComponentPreview({
  component,
  products,
}: {
  component: MicroComponent;
  products: PreviewProduct[];
}) {
  const props = asProps(component);
  const style = boxStyle(component);

  if (!component.visible) {
    return (
      <div className="micro-preview-hidden">
        已隐藏：{MICRO_COMPONENT_LABELS[component.type as keyof typeof MICRO_COMPONENT_LABELS] ?? component.type}
      </div>
    );
  }

  switch (component.type) {
    case 'notice':
      return (
        <div className="micro-notice" style={style}>
          {Boolean(props.tag) && <span className="micro-notice-tag">{String(props.tag)}</span>}
          <span style={{ color: (props.textColor as string) || undefined }}>{String(props.text ?? '')}</span>
        </div>
      );
    case 'search': {
      const shape = String(props.shape ?? 'capsule');
      return (
        <div style={style}>
          <div
            className="micro-search"
            style={{
              borderRadius: shape === 'capsule' ? 999 : shape === 'rounded' ? 8 : 2,
              background: (props.bgColor as string) || 'rgba(255,255,255,0.9)',
              color: (props.textColor as string) || tokens.color.ink3,
            }}
          >
            <span>⌕</span>
            <span>{String(props.placeholder ?? '搜索')}</span>
          </div>
        </div>
      );
    }
    case 'banner': {
      const items = records(props.items);
      const ratio = String(props.ratio ?? '2:1');
      const first = items[0];
      return (
        <div style={style}>
          <div className="micro-banner" style={{ paddingTop: RATIO_PERCENT[ratio] ?? '50%' }}>
            {first && typeof first.imageKey === 'string' && first.imageKey ? (
              <img src={assetPreviewUrl(first.imageKey)} alt="" />
            ) : (
              <span>轮播图</span>
            )}
            {items.length > 1 && <i className="micro-badge">{items.length} 张</i>}
          </div>
        </div>
      );
    }
    case 'imageHotspot': {
      const spots = records(props.hotspots);
      return (
        <div style={style}>
          <div className="micro-hotspot">
            {props.imageKey ? (
              <img src={assetPreviewUrl(String(props.imageKey))} alt={String(props.alt ?? '')} />
            ) : (
              <span>图片热区</span>
            )}
            {spots.map((spot, index) => (
              <i
                key={index}
                style={{
                  left: `${Number(spot.x ?? 0)}%`,
                  top: `${Number(spot.y ?? 0)}%`,
                  width: `${Number(spot.w ?? 10)}%`,
                  height: `${Number(spot.h ?? 10)}%`,
                }}
              >
                {index + 1}
              </i>
            ))}
          </div>
        </div>
      );
    }
    case 'goods':
      return (
        <div style={style}>
          <GoodsPreview component={component} products={products} />
        </div>
      );
    case 'divider':
      return (
        <div style={style}>
          <div
            style={{
              margin: `${Number(props.spacing ?? 12)}px 0`,
              borderTop: `${Number(props.thickness ?? 1)}px ${String(props.style ?? 'solid')} ${String(props.color ?? tokens.color.line2)}`,
            }}
          />
        </div>
      );
    case 'video': {
      const ratio = String(props.ratio ?? '16:9');
      const videoKey = String(props.videoKey ?? '');
      return (
        <div style={style}>
          <div className="micro-video" style={{ paddingTop: RATIO_PERCENT[ratio] ?? '56.25%' }}>
            {videoKey ? (
              <video src={assetPreviewUrl(videoKey)} muted playsInline preload="metadata" />
            ) : (
              <span>视频</span>
            )}
          </div>
        </div>
      );
    }
    case 'text':
      return (
        <div
          style={{
            ...style,
            fontSize: Number(props.fontSize ?? 14),
            color: String(props.color ?? tokens.color.ink),
            fontWeight: props.weight === 'bold' ? 700 : 400,
            textAlign: (props.align as 'left' | 'center' | 'right') ?? 'left',
            lineHeight: Number(props.lineHeight ?? 1.5),
            whiteSpace: 'pre-wrap',
          }}
        >
          {String(props.content ?? '')}
        </div>
      );
    case 'navGrid': {
      const items = records(props.items);
      const columns = Number(props.columns ?? 4);
      return (
        <div style={style}>
          <div
            className="micro-nav"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {items.map((item, index) => (
              <div key={index} className="micro-nav-item">
                {typeof item.iconKey === 'string' && item.iconKey ? (
                  <img src={assetPreviewUrl(item.iconKey)} alt="" />
                ) : (
                  <span className="micro-nav-ph">{String(item.name ?? '入').slice(0, 1)}</span>
                )}
                <em style={{ fontSize: Number(props.fontSize ?? 12) }}>{String(item.name ?? '')}</em>
              </div>
            ))}
          </div>
        </div>
      );
    }
    default:
      return <div className="micro-preview-unknown">未知组件：{component.type}</div>;
  }
}

export function bannerRatioOptions() {
  return MICRO_BANNER_RATIOS;
}
