import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, concatMap } from 'rxjs';

import { PrismaService } from '../prisma/prisma.module';
import type { AuthUser } from './auth.guards';

type AuditedRequest = Request & { user?: AuthUser };

const TARGET_TYPE_BY_SEGMENT: Record<string, string> = {
  orders: 'Order',
  'after-sales': 'AfterSale',
  coupons: 'Coupon',
  'member-levels': 'MemberLevel',
  customers: 'Customer',
  reviews: 'Review',
  products: 'Product',
  categories: 'Category',
  tags: 'Tag',
  shop: 'ShopSetting',
  assets: 'Asset',
  accounts: 'AdminAccount',
  integration: 'Integration',
  miniapp: 'MiniappRelease',
};

/** 敏感字段：密钥、密码、文件内容一律不落审计日志 */
const SECRET_KEYS = new Set([
  'password',
  'passwordHash',
  'contentBase64',
  'content',
  'secret',
  'appSecret',
  'miniappAppSecret',
  'apiKey',
  'apiV3Key',
  'privateKey',
  'mchKey',
]);

/** 递归剔除请求体中的密码与密钥字段，避免明文落库 */
function scrubSecrets(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrubSecrets(item));

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (SECRET_KEYS.has(key)) continue;
    result[key] = scrubSecrets(item);
  }
  return result;
}

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AdminAuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuditedRequest>();
    const path = req.path ?? req.originalUrl ?? '';
    const method = (req.method ?? 'GET').toUpperCase();

    if (!path.startsWith('/api/admin/') || method === 'GET') {
      return next.handle();
    }

    return next.handle().pipe(
      concatMap(async (data) => {
        await this.write(req, path, method);
        return data;
      }),
    );
  }

  private async write(req: AuditedRequest, path: string, method: string): Promise<void> {
    const user = req.user;
    if (!user?.sub) return;

    const segment = path.replace(/^.*\/admin\//, '').split('/')[0] ?? '';
    const params = (req.params ?? {}) as Record<string, unknown>;
    const targetId = typeof params.id === 'string' ? params.id : undefined;

    try {
      await this.prisma.operationLog.create({
        data: {
          actorId: user.sub,
          actorName: user.name ?? '',
          action: `${method} ${path}`,
          targetType: TARGET_TYPE_BY_SEGMENT[segment] ?? 'Admin',
          targetId: targetId ?? '',
          afterJson: scrubSecrets(req.body ?? {}) as never,
          ip: req.ip,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`操作日志写入失败：${message}`);
    }
  }
}
