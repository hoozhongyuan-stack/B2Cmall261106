import { useEffect, useState, type ReactNode } from 'react';

import { tokens } from '@shanye/tokens';
import {
  MICRO_LINK_LABELS,
  MICRO_LINK_TYPES,
  type MicroComponentStyle,
  type MicroLink,
} from '@shanye/shared/src/microPage';

import { listLinkOptions, type LinkOption } from '../../api/microPages';
import { Button, Field } from '../ui';

export function TextInput({
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <input
      className="input"
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      className="input"
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

export function ColorInput({
  value,
  onChange,
  fallback = tokens.color.surface,
}: {
  value: string;
  onChange: (next: string) => void;
  fallback?: string;
}) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <input
        type="color"
        className="micro-color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback}
        onChange={(event) => onChange(event.target.value)}
      />
      <input
        className="input"
        value={value}
        placeholder="留空使用默认"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function CheckInput({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="row small" style={{ gap: 6 }}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

export function SelectInput<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <select className="input" value={value} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function SubField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Field label={label}>
      <div className="micro-subfield">{children}</div>
    </Field>
  );
}

/* ---------------- 统一链接选择 ---------------- */

const NEEDS_TARGET: string[] = [
  'micro',
  'product',
  'category',
  'seckill',
  'coupon',
  'store',
  'page',
];

export function LinkField({
  value,
  onChange,
  label = '点击跳转',
}: {
  value: MicroLink | undefined;
  onChange: (next: MicroLink) => void;
  label?: string;
}) {
  const current = value ?? { type: 'none', value: null };
  const [keyword, setKeyword] = useState('');
  const [options, setOptions] = useState<LinkOption[]>([]);
  const [loading, setLoading] = useState(false);

  const needsTarget = NEEDS_TARGET.includes(current.type);

  async function load(type: string, search?: string) {
    if (!needsTargetFor(type)) return;
    setLoading(true);
    try {
      const result = await listLinkOptions(type, search, 50);
      setOptions(result.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setOptions([]);
    setKeyword('');
    void load(current.type);
  }, [current.type]);

  return (
    <div className="micro-link-field">
      <Field label={label}>
        <select
          className="input"
          value={current.type}
          onChange={(event) => {
            const type = event.target.value as MicroLink['type'];
            onChange({ type, value: type === 'none' ? null : '' });
            void load(type);
          }}
        >
          {MICRO_LINK_TYPES.map((type) => (
            <option key={type} value={type}>
              {MICRO_LINK_LABELS[type]}
            </option>
          ))}
        </select>
      </Field>

      {current.type === 'search' && (
        <Field label="搜索关键词">
          <TextInput
            value={current.value ?? ''}
            maxLength={50}
            placeholder="例如 普洱"
            onChange={(next) => onChange({ ...current, value: next })}
          />
        </Field>
      )}

      {needsTarget && (
        <>
          <div className="row" style={{ gap: 6, marginBottom: 6 }}>
            <input
              className="input"
              placeholder="搜索目标"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void load(current.type, keyword.trim());
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              loading={loading}
              onClick={() => void load(current.type, keyword.trim())}
            >
              搜索
            </Button>
          </div>
          <select
            className="input"
            value={current.value ?? ''}
            onChange={(event) => onChange({ ...current, value: event.target.value })}
          >
            <option value="">请选择</option>
            {current.value &&
              !options.some((option) => option.value === current.value) && (
                <option value={current.value}>当前选择（{current.value}）</option>
              )}
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
                {option.hint ? `（${option.hint}）` : ''}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

function needsTargetFor(type: string): boolean {
  return NEEDS_TARGET.includes(type);
}

/* ---------------- 通用样式 ---------------- */

const SPACING_FIELDS = ['上', '右', '下', '左'];

export function StyleFields({
  style,
  onChange,
}: {
  style: MicroComponentStyle;
  onChange: (next: MicroComponentStyle) => void;
}) {
  const margin = style.margin ?? [0, 0, 0, 0];
  const padding = style.padding ?? [0, 0, 0, 0];

  function update(key: 'margin' | 'padding', index: number, value: number) {
    const next = [...(style[key] ?? [0, 0, 0, 0])];
    next[index] = value;
    onChange({ ...style, [key]: next });
  }

  return (
    <div className="micro-style-grid">
      <div className="micro-style-row">
        <span>外边距</span>
        {SPACING_FIELDS.map((label, index) => (
          <input
            key={`m-${label}`}
            className="input"
            type="number"
            aria-label={`外边距${label}`}
            value={margin[index] ?? 0}
            onChange={(event) => update('margin', index, Number(event.target.value))}
          />
        ))}
      </div>
      <div className="micro-style-row">
        <span>内边距</span>
        {SPACING_FIELDS.map((label, index) => (
          <input
            key={`p-${label}`}
            className="input"
            type="number"
            aria-label={`内边距${label}`}
            value={padding[index] ?? 0}
            onChange={(event) => update('padding', index, Number(event.target.value))}
          />
        ))}
      </div>
      <Field label="背景色">
        <ColorInput
          value={style.bgColor ?? ''}
          fallback={tokens.color.surface}
          onChange={(next) => onChange({ ...style, bgColor: next })}
        />
      </Field>
      <Field label="圆角">
        <NumberInput
          value={style.radius ?? 0}
          min={0}
          max={32}
          onChange={(next) => onChange({ ...style, radius: next })}
        />
      </Field>
    </div>
  );
}
