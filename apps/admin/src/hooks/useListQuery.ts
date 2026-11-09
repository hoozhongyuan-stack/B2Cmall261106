import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * 列表页 URL 状态：筛选项与分页写入 query，刷新/返回/分享可恢复。
 * defaults 必须是模块级常量（对象引用稳定）。
 */
export function useListQuery<K extends string>(
  defaults: Record<K, string>,
): [Record<K, string>, (updates: Partial<Record<K, string>>, options?: { resetPage?: boolean }) => void] {
  const [params, setParams] = useSearchParams();

  const values = useMemo(() => {
    const next = { ...defaults };
    for (const key of Object.keys(defaults) as K[]) {
      const value = params.get(key);
      if (value !== null) next[key] = value as never;
    }
    return next;
  }, [params, defaults]);

  const patch = useCallback(
    (updates: Partial<Record<K, string>>, options?: { resetPage?: boolean }) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === null || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      if (options?.resetPage && !('page' in updates)) next.delete('page');
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  return [values, patch];
}
