import Taro from '@tarojs/taro';

interface ClientErrorPayload {
  message: string;
  name?: string;
  stack?: string;
}

function currentPath(): string {
  try {
    return Taro.getCurrentInstance().router?.path ?? '';
  } catch {
    return '';
  }
}

/** 服务端有长度上限，超长内容先截断，避免上报本身被 400 拒绝 */
function clip(value: string | undefined, max: number): string | undefined {
  return typeof value === 'string' ? value.slice(0, max) : undefined;
}

/** 上报失败的请求本身不再上报，避免错误风暴 */
function send(payload: ClientErrorPayload): void {
  void Taro.request({
    url: `${API_BASE}/telemetry/client-error`,
    method: 'POST',
    header: { 'content-type': 'application/json' },
    data: {
      source: 'miniapp',
      path: clip(currentPath(), 500),
      message: clip(payload.message, 200),
      name: clip(payload.name, 200),
      stack: clip(payload.stack, 4000),
    },
  }).catch(() => undefined);
}

/** 全局兜底：小程序运行时报错与未处理的 Promise 拒绝统一上报 */
export function installErrorReporting(): void {
  const onError = (Taro as unknown as { onError?: (cb: (err: string) => void) => void }).onError;
  if (typeof onError === 'function') {
    onError((err) => send({ message: String(err) }));
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('error', (event) => {
      send({
        message: event.message || '未知错误',
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      send({
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    });
  }
}
