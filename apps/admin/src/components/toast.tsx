import { useEffect, useState } from 'react';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

let seq = 0;
let items: ToastItem[] = [];
const listeners = new Set<(next: ToastItem[]) => void>();

function emit(): void {
  for (const listener of listeners) listener(items);
}

/** 轻提示：失败信息统一走这里，避免每页重复写 banner */
export function toast(text: string, kind: ToastKind = 'success'): void {
  const item = { id: ++seq, kind, text };
  items = [...items, item];
  emit();
  setTimeout(() => {
    items = items.filter((i) => i.id !== item.id);
    emit();
  }, 3200);
}

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);

  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  return (
    <div className="toaster">
      {list.map((item) => (
        <div key={item.id} className={`toast toast-${item.kind}`}>
          {item.text}
        </div>
      ))}
    </div>
  );
}
