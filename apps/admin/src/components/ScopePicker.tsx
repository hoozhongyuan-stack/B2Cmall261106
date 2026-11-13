import { useState } from 'react';

import { Empty } from './ui';

export interface ScopeOption {
  id: string;
  name: string;
  /** 二级分组名称（如分类的上级分类） */
  group?: string | null;
}

/**
 * 适用范围多选：搜索 + 勾选 + 已选标签，替代原生 multiple select。
 * 一级选项直接平铺，二级选项按 group 分组展示。
 */
export function ScopePicker({
  options,
  selected,
  onChange,
  placeholder = '搜索名称…',
  emptyText = '没有可选项',
}: {
  options: ScopeOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  emptyText?: string;
}) {
  const [keyword, setKeyword] = useState('');
  const term = keyword.trim().toLowerCase();
  const matched = options.filter((item) => {
    if (!term) return true;
    return (
      item.name.toLowerCase().includes(term) || (item.group ?? '').toLowerCase().includes(term)
    );
  });

  const ungrouped = matched.filter((item) => !item.group);
  const groups = new Map<string, ScopeOption[]>();
  for (const item of matched) {
    if (!item.group) continue;
    const list = groups.get(item.group) ?? [];
    list.push(item);
    groups.set(item.group, list);
  }

  const selectedOptions = options.filter((item) => selected.includes(item.id));

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  };

  return (
    <div className="scope-picker">
      <div className="scope-picker-head">
        <input
          className="input"
          value={keyword}
          placeholder={placeholder}
          aria-label="搜索可选项"
          onChange={(event) => setKeyword(event.target.value)}
        />
        {selected.length > 0 && (
          <button type="button" className="btn btn-plain btn-sm" onClick={() => onChange([])}>
            清空已选
          </button>
        )}
      </div>

      {selectedOptions.length > 0 && (
        <div className="scope-picker-selected">
          {selectedOptions.map((item) => (
            <span className="scope-chip" key={item.id}>
              {item.group ? `${item.group} / ${item.name}` : item.name}
              <button type="button" aria-label={`移除 ${item.name}`} onClick={() => toggle(item.id)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="scope-picker-list">
        {matched.length === 0 ? (
          <Empty text={emptyText} />
        ) : (
          <>
            {ungrouped.length > 0 && (
              <div className="scope-options">
                {ungrouped.map((item) => (
                  <label className="scope-option" key={item.id}>
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => toggle(item.id)}
                    />
                    <span>{item.name}</span>
                  </label>
                ))}
              </div>
            )}
            {[...groups.entries()].map(([group, children]) => (
              <div key={group}>
                <div className="scope-group-name">{group}</div>
                <div className="scope-options">
                  {children.map((item) => (
                    <label className="scope-option" key={item.id}>
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={selected.includes(item.id)}
                        onChange={() => toggle(item.id)}
                      />
                      <span>{item.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="scope-picker-foot">
        <span>
          已选 {selected.length} 项
          {term ? `，筛选出 ${matched.length} 项` : ''}
        </span>
        {matched.length > 0 && (
          <button
            type="button"
            onClick={() =>
              onChange([...new Set([...selected, ...matched.map((item) => item.id)])])
            }
          >
            全选筛选结果
          </button>
        )}
      </div>
    </div>
  );
}
