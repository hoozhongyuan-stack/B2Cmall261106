import { useCallback, useEffect, useState } from 'react';

import { showError } from '../api/client';

/** 页面数据加载：统一 loading / error / reload，避免每个页面复写 */
export function useRequest<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetcher());
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => {
    void run();
  }, [run]);

  return { data, loading, reload: run, setData };
}
