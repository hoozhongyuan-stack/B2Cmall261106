const ENDPOINT = '/api/telemetry/client-error';

interface ClientErrorPayload {
  message: string;
  name?: string;
  stack?: string;
  path?: string;
}

/** 服务端有长度上限，超长内容先截断，避免上报本身被 400 拒绝 */
function clip(value: string | undefined, max: number): string | undefined {
  return typeof value === 'string' ? value.slice(0, max) : undefined;
}

/** 上报失败的请求本身不再上报，避免错误风暴 */
function send(payload: ClientErrorPayload): void {
  const body = JSON.stringify({
    source: 'admin',
    path: clip(payload.path ?? window.location.pathname, 500),
    userAgent: clip(navigator.userAgent, 300),
    message: clip(payload.message, 200),
    name: clip(payload.name, 200),
    stack: clip(payload.stack, 4000),
  });
  void fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

/** 全局兜底：未捕获异常与未处理的 Promise 拒绝统一上报到服务端日志 */
export function installErrorReporting(): void {
  window.addEventListener('error', (event) => {
    if (!event.message) return;
    send({
      message: event.message,
      name: event.error instanceof Error ? event.error.name : undefined,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    send({
      message: reason instanceof Error ? reason.message : String(reason),
      name: reason instanceof Error ? reason.name : undefined,
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}
