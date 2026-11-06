import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/** 业务错误码：HTTP 状态之外，给前端稳定的判断依据 */
const ERROR_CODE_MAP: Record<string, string> = {
  '库存不足': 'STOCK_NOT_ENOUGH',
  '订单状态已变化': 'ORDER_STATE_CONFLICT',
  '账号或密码错误': 'AUTH_INVALID_CREDENTIALS',
  '账号已锁定': 'AUTH_LOCKED',
  '未登录或登录已失效': 'AUTH_UNAUTHORIZED',
  '无权限执行该操作': 'FORBIDDEN',
  '已有售后单': 'AFTER_SALE_EXISTS',
  '售后期': 'AFTER_SALE_EXPIRED',
  '累计退款金额超过': 'REFUND_OVER_LIMIT',
  '每人限领': 'COUPON_CLAIM_LIMIT',
  '优惠券已领完': 'COUPON_SOLD_OUT',
  '该商品已评价': 'REVIEW_EXISTS',
  '仅已完成订单可评价': 'REVIEW_NOT_ALLOWED',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = '服务器内部错误';
    let code = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const detail = typeof body === 'object' && body !== null
        ? (body as { message?: unknown; code?: string })
        : null;

      message =
        typeof body === 'string'
          ? body
          : (detail?.message as string) || exception.message;
      if (Array.isArray(message)) message = (message as string[]).join('；');

      // 显式声明的业务码优先（如 RATE_LIMITED），其次按文案映射，最后按状态兜底
      code =
        detail?.code ??
        (Object.entries(ERROR_CODE_MAP).find(([k]) => message.includes(k))?.[1]) ??
        (status === 401
          ? 'AUTH_UNAUTHORIZED'
          : status === 403
            ? 'FORBIDDEN'
            : status === 429
              ? 'RATE_LIMITED'
              : status === 503
                ? 'SERVICE_UNAVAILABLE'
                : status >= 500
                  ? 'INTERNAL_ERROR'
                  : 'BAD_REQUEST');

      // 5xx 的 HttpException 同样需要留痕，否则线上只能看到一句「内部错误」
      if (status >= 500) {
        this.logger.error(
          `服务端异常 requestId=${req.requestId} ${req.method} ${req.originalUrl} status=${status} code=${code} message=${message}`,
          exception.stack,
        );
      }
    } else {
      this.logger.error(
        `未捕获异常 requestId=${req.requestId} ${req.method} ${req.originalUrl}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json({
      code,
      message,
      data: null,
      requestId: req.requestId ?? '',
    });
  }
}
