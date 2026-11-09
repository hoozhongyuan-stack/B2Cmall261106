import { useEffect, useState } from 'react';

import { Button, Modal } from './ui';

interface ConfirmRequest {
  text: string;
  confirmText: string;
  danger: boolean;
  resolve: (value: boolean) => void;
}

let current: ConfirmRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** 全局确认框：替代 window.confirm，保持与后台一致的弹窗样式 */
export function confirmAction(
  text: string,
  options: { confirmText?: string; danger?: boolean } = {},
): Promise<boolean> {
  current?.resolve(false);
  return new Promise((resolve) => {
    current = {
      text,
      confirmText: options.confirmText ?? '确定',
      danger: options.danger ?? true,
      resolve,
    };
    emit();
  });
}

export function ConfirmHost() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const listener = () => forceUpdate((value) => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (!current) return null;
  const request = current;
  const close = (value: boolean) => {
    request.resolve(value);
    current = null;
    emit();
  };

  return (
    <Modal
      open
      title="确认操作"
      onClose={() => close(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            取消
          </Button>
          <Button variant={request.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
            {request.confirmText}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 13.5 }}>{request.text}</p>
    </Modal>
  );
}
