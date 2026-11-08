import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { money } from '../api/client';

/* ---------------- 基础展示 ---------------- */

export function Money({ cents, muted }: { cents: number | null | undefined; muted?: boolean }) {
  return <span className={muted ? 'money muted' : 'money'}>{money(cents)}</span>;
}

export function Card({
  title,
  extra,
  children,
  className = '',
  padded = true,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || extra) && (
        <header className="card-hd">
          <h3>{title}</h3>
          {extra && <div className="card-extra">{extra}</div>}
        </header>
      )}
      <div className={padded ? 'card-bd' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  desc,
  actions,
}: {
  title: string;
  desc?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-hd">
      <div>
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'brand' | 'ok' | 'warn';
}) {
  return (
    <div className={`stat stat-${tone}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function Tag({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'brand' | 'ok' | 'warn' | 'danger' | 'gold';
}) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

export function Empty({ text = '暂无数据' }: { text?: string }) {
  return <div className="empty">{text}</div>;
}

/* ---------------- 表单 ---------------- */

export function Field({
  label,
  hint,
  children,
  wide,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? 'field field-wide' : 'field'}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger' | 'plain';
  size?: 'md' | 'sm';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={`btn btn-${variant} btn-${size} ${className}`}
      disabled={rest.disabled || loading}
    >
      {loading ? '处理中…' : children}
    </button>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

/* ---------------- 表格 ---------------- */

export interface Column<T> {
  key: string;
  title: ReactNode;
  width?: string;
  align?: 'left' | 'right' | 'center';
  render?: (row: T, index: number) => ReactNode;
}

export function DataTable<T extends { id?: string }>({
  columns,
  rows,
  empty = '暂无数据',
  loading,
  onRowClick,
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  rowKey?: (row: T, index: number) => string;
}) {
  if (loading) return <div className="table-loading">加载中…</div>;
  if (!rows.length) return <Empty text={empty} />;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={{ width: col.width, textAlign: col.align ?? 'left' }}>
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey ? rowKey(row, index) : ((row.id as string) ?? String(index))}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'clickable' : ''}
            >
              {columns.map((col) => (
                <td key={col.key} style={{ textAlign: col.align ?? 'left' }}>
                  {col.render ? col.render(row, index) : String((row as Record<string, unknown>)[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- 弹层 / 标签页 ---------------- */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;

  // 弹窗挂到 body：避免嵌套在页面表单 / label 内导致按钮误触发表单提交
  return createPortal(
    <div className="modal-mask" onClick={onClose}>
      <div className={wide ? 'modal modal-lg' : 'modal'} onClick={(e) => e.stopPropagation()}>
        <header className="modal-hd">
          <h3>{title}</h3>
          <button type="button" className="modal-x" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="modal-bd">{children}</div>
        {footer && <footer className="modal-ft">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={item.value === value ? 'tab on' : 'tab'}
          onClick={() => onChange(item.value)}
        >
          {item.label}
          {typeof item.count === 'number' && <em>{item.count}</em>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  if (pages <= 1) return null;
  return (
    <div className="pagination">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        上一页
      </Button>
      <span>
        {page} / {pages} 页，共 {total} 条
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        下一页
      </Button>
    </div>
  );
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="kv">
      {items.map((item) => (
        <div key={item.label} className="kv-row">
          <dt>{item.label}</dt>
          <dd>{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
