import { useEffect, useRef, useState, type ReactNode } from 'react';
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

export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div className="table-skeleton" aria-label="加载中" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-row">
          <span className="skeleton-bar" />
          <span className="skeleton-bar" />
          <span className="skeleton-bar" />
        </div>
      ))}
    </div>
  );
}

/* ---------------- 表单 ---------------- */

export function Field({
  label,
  hint,
  children,
  wide,
  required,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
  required?: boolean;
}) {
  return (
    <label className={wide ? 'field field-wide' : 'field'}>
      <span className="field-label">
        {label}
        {required && (
          <span className="field-required" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </span>
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
  minWidth?: number;
  maxWidth?: number;
  align?: 'left' | 'right' | 'center';
  truncate?: boolean;
  render?: (row: T, index: number) => ReactNode;
}

export interface SelectionConfig<T> {
  selected: string[];
  onChange: (ids: string[]) => void;
  getKey?: (row: T) => string;
  isDisabled?: (row: T) => boolean;
}

function SelectCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="checkbox"
      checked={checked}
      aria-label={label}
      onChange={onChange}
    />
  );
}

export function DataTable<T extends { id?: string }>({
  columns,
  rows,
  empty = '暂无数据',
  loading,
  onRowClick,
  rowKey,
  selection,
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  rowKey?: (row: T, index: number) => string;
  selection?: SelectionConfig<T>;
}) {
  if (loading) return <SkeletonTable />;
  if (!rows.length) return <Empty text={empty} />;

  const minWidth = columns.reduce((sum, col) => sum + (col.minWidth ?? 0), 0);
  const keyOf = (row: T, index: number) =>
    selection?.getKey?.(row) ?? (row.id as string) ?? String(index);
  const selectableKeys = rows
    .map((row, index) => ({ key: keyOf(row, index), row }))
    .filter((item) => !selection?.isDisabled?.(item.row))
    .map((item) => item.key);
  const selectedSet = new Set(selection?.selected ?? []);
  const selectedOnPage = selectableKeys.filter((key) => selectedSet.has(key));
  const allSelected = selectableKeys.length > 0 && selectedOnPage.length === selectableKeys.length;
  const someSelected = selectedOnPage.length > 0 && !allSelected;

  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (allSelected) for (const key of selectableKeys) next.delete(key);
    else for (const key of selectableKeys) next.add(key);
    selection.onChange([...next]);
  };

  const toggleOne = (key: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selection.onChange([...next]);
  };

  return (
    <div className="table-wrap">
      <table className="table" style={minWidth ? { minWidth } : undefined}>
        <thead>
          <tr>
            {selection && (
              <th className="col-check">
                <SelectCheckbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={toggleAll}
                  label="全选当前页"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                style={{ width: col.width, minWidth: col.minWidth, textAlign: col.align ?? 'left' }}
              >
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const key = keyOf(row, index);
            const disabled = Boolean(selection?.isDisabled?.(row));
            return (
              <tr
                key={rowKey ? rowKey(row, index) : key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? 'clickable' : ''}
              >
                {selection && (
                  <td className="col-check" onClick={(event) => event.stopPropagation()}>
                    <SelectCheckbox
                      checked={selectedSet.has(key)}
                      onChange={() => toggleOne(key)}
                      label={disabled ? '该行不可批量操作' : '选择该行'}
                    />
                  </td>
                )}
                {columns.map((col) => {
                  const content = col.render
                    ? col.render(row, index)
                    : String((row as Record<string, unknown>)[col.key] ?? '—');
                  return (
                    <td
                      key={col.key}
                      style={{ textAlign: col.align ?? 'left', maxWidth: col.maxWidth }}
                      title={col.truncate && typeof content === 'string' ? content : undefined}
                    >
                      {col.truncate ? <div className="cell-clip">{content}</div> : content}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- 行内操作 ---------------- */

export interface RowAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
  disabled?: boolean;
}

export function RowActions({ primary, actions }: { primary?: RowAction; actions: RowAction[] }) {
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const visible = actions.filter((action) => !action.hidden);

  // 表格容器有横向滚动，菜单挂到 body 避免被裁切；点击外部时关闭
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setMenu(null);
    }
    window.addEventListener('resize', close);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('resize', close);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [menu]);

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 132;
    setMenu({
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      top: rect.bottom + 4,
    });
  }

  return (
    <div className="row-actions">
      {primary && (
        <Button size="sm" variant="ghost" onClick={primary.onClick}>
          {primary.label}
        </Button>
      )}
      {visible.length > 0 && (
        <>
          <button
            ref={triggerRef}
            type="button"
            className="btn btn-plain btn-sm"
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            onClick={() => (menu ? setMenu(null) : openMenu())}
          >
            更多 ▾
          </button>
          {menu &&
            createPortal(
              <div
                ref={menuRef}
                className="row-menu row-menu--fixed"
                style={{ left: menu.left, top: menu.top }}
                role="menu"
              >
                {visible.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    role="menuitem"
                    className={action.danger ? 'danger' : undefined}
                    onClick={() => {
                      setMenu(null);
                      action.onClick();
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>,
              document.body,
            )}
        </>
      )}
    </div>
  );
}

/* ---------------- 批量操作条 ---------------- */

export function BulkBar({
  count,
  actions,
  onClear,
  hint,
}: {
  count: number;
  actions: RowAction[];
  onClear: () => void;
  hint?: string;
}) {
  if (!count) return null;
  return createPortal(
    <div className="bulk-bar" role="region" aria-label="批量操作">
      <span className="bulk-count">已选 {count} 项</span>
      {hint && <span className="bulk-hint">{hint}</span>}
      <div className="bulk-actions">
        {actions.map((action) => (
          <Button
            key={action.label}
            size="sm"
            variant={action.danger ? 'danger' : 'ghost'}
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        ))}
      </div>
      <button type="button" className="bulk-clear" onClick={onClear}>
        取消选择
      </button>
    </div>,
    document.body,
  );
}

/* ---------------- 确认弹窗 ---------------- */

export function Confirm({
  open,
  title = '确认操作',
  text,
  confirmText = '确定',
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  text: ReactNode;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmText}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 13.5 }}>{text}</p>
    </Modal>
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

function pageNumbers(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...wanted].sort((a, b) => a - b);
  const result: (number | '…')[] = [];
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1] > 1) result.push('…');
    result.push(value);
  });
  return result;
}

export function Pagination({
  page,
  total,
  pageSize,
  onChange,
  onPageSizeChange,
  pageSizeOptions = [20, 50, 100],
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
}) {
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const current = Math.min(Math.max(page, 1), pages);

  return (
    <div className="pagination">
      <span className="pagination-total">共 {total} 条</span>
      <div className="pagination-pages">
        <Button
          type="button"
          variant="plain"
          size="sm"
          disabled={current <= 1}
          onClick={() => onChange(current - 1)}
        >
          上一页
        </Button>
        {pageNumbers(current, pages).map((item, index) =>
          item === '…' ? (
            <span key={`gap-${index}`} className="pagination-gap">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={`pagination-num${item === current ? ' on' : ''}`}
              aria-current={item === current ? 'page' : undefined}
              onClick={() => onChange(item)}
            >
              {item}
            </button>
          ),
        )}
        <Button
          type="button"
          variant="plain"
          size="sm"
          disabled={current >= pages}
          onClick={() => onChange(current + 1)}
        >
          下一页
        </Button>
      </div>
      {onPageSizeChange && (
        <label className="pagination-size">
          每页
          <select
            className="select"
            value={pageSize}
            aria-label="每页条数"
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          条
        </label>
      )}
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
