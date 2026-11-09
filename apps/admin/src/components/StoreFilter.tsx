import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';

export interface StoreOption {
  id: string;
  name: string;
}

/** 门店下拉数据：总部页面共用，翻页加载全量门店（单页上限 200） */
export function useStoreOptions() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  useEffect(() => {
    let alive = true;
    async function load() {
      const all: StoreOption[] = [];
      for (let page = 1; ; page += 1) {
        const result = await api<{ items: StoreOption[]; total: number }>('/admin/stores', {
          query: { pageSize: 200, page },
        });
        all.push(...result.items);
        if (!result.items.length || all.length >= result.total) break;
      }
      if (alive) setStores(all);
    }
    load().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return stores;
}

/**
 * 门店多选筛选：总部跨店视图使用。
 * 未选表示全部门店；已选则按门店收窄。
 */
export function StoreFilter({
  stores,
  value,
  onChange,
}: {
  stores: StoreOption[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const selectedNames = stores
    .filter((store) => value.includes(store.id))
    .map((store) => store.name);
  const label =
    selectedNames.length === 0
      ? '全部门店'
      : selectedNames.length === 1
        ? selectedNames[0]
        : `已选 ${selectedNames.length} 家门店`;

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  }

  return (
    <div className="filter-pop" ref={ref}>
      <button
        type="button"
        className={`filter-btn${value.length ? ' active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="按门店筛选"
        onClick={() => setOpen((prev) => !prev)}
      >
        {label}
        <span className="filter-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="filter-panel" role="listbox" aria-multiselectable="true">
          <div className="filter-panel-hd">
            <span className="small muted">按门店筛选</span>
            <button
              type="button"
              className="filter-link"
              onClick={() => onChange(value.length ? [] : stores.map((store) => store.id))}
            >
              {value.length ? '清空' : '全选'}
            </button>
          </div>
          <div className="filter-panel-body">
            {stores.map((store) => (
              <label key={store.id} className="filter-option">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={value.includes(store.id)}
                  onChange={() => toggle(store.id)}
                />
                <span>{store.name}</span>
              </label>
            ))}
            {!stores.length && <span className="small muted">暂无门店</span>}
          </div>
        </div>
      )}
    </div>
  );
}
