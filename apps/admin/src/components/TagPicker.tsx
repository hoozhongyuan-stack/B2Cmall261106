import { Empty } from './ui';

export interface TagOption {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
}

/**
 * 两级标签多选：一级标签作为分组标题，可直接勾选；二级标签缩进勾选。
 */
export function TagPicker({
  options,
  selected,
  onChange,
}: {
  options: TagOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  if (!options.length) return <Empty text="还没有用户标签，请先在「用户标签」中创建" />;

  const roots = options.filter((item) => !item.parentId);
  const childrenOf = (id: string) => options.filter((item) => item.parentId === id);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  };

  return (
    <div className="tag-picker">
      {roots.map((root) => {
        const children = childrenOf(root.id);
        return (
          <div className="tag-picker-group" key={root.id}>
            <label className="tag-picker-item">
              <input
                type="checkbox"
                className="checkbox"
                checked={selected.includes(root.id)}
                onChange={() => toggle(root.id)}
              />
              <span>{root.name}</span>
            </label>
            {children.length > 0 && (
              <div className="tag-picker-children">
                {children.map((child) => (
                  <label className="tag-picker-item" key={child.id}>
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={selected.includes(child.id)}
                      onChange={() => toggle(child.id)}
                    />
                    <span className="small">{child.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {selected.length > 0 && (
        <button type="button" className="tag-picker-clear" onClick={() => onChange([])}>
          清空已选（{selected.length}）
        </button>
      )}
    </div>
  );
}
