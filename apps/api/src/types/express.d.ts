declare global {
  namespace Express {
    interface Request {
      /** 由 main.ts 的中间件注入，用于日志与错误响应串联 */
      requestId?: string;
    }
  }
}

export {};
