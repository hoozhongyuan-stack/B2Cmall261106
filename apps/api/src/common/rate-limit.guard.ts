import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

export interface RateLimitOptions {
  /** 窗口内允许的请求数 */
  limit: number;
  /** 窗口长度（毫秒） */
  windowMs: number;
}

export const RATE_LIMIT_KEY = 'rate_limit';

/** 标注在 Controller / Handler 上；未标注的接口不限流 */
export const RateLimit = (options: RateLimitOptions): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * 进程内固定窗口限流：单实例够用，多实例部署时需换成 Redis。
 * 只对显式标注 @RateLimit 的接口生效，避免误伤正常业务。
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const key = `${context.getClass().name}:${context.getHandler().name}:${clientIp(req)}`;
    const now = Date.now();

    this.prune(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return true;
    }

    bucket.count += 1;
    if (bucket.count > options.limit) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: '请求过于频繁，请稍后再试',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  /** 请求量增长时清理过期桶，避免内存无限增长 */
  private prune(now: number): void {
    if (this.buckets.size < 5000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
