import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface MiniappUser {
  sub: string;
  scope: 'miniapp';
}

/** 小程序用户令牌：与后台令牌共用签名但区分 scope，互不通用 */
@Injectable()
export class UserJwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('未登录或登录已失效');

    try {
      const payload = await this.jwt.verifyAsync<MiniappUser & { scope?: string }>(header.slice(7));
      if (payload.scope !== 'miniapp') throw new Error('scope mismatch');
      req.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('未登录或登录已失效');
    }
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): MiniappUser => ctx.switchToHttp().getRequest().user,
);

/** 可选用户令牌：携带有效小程序令牌时注入用户，无令牌或令牌无效时按匿名放行 */
@Injectable()
export class OptionalUserJwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) return true;

    try {
      const payload = await this.jwt.verifyAsync<MiniappUser>(header.slice(7));
      if (payload.scope === 'miniapp') req.user = payload;
    } catch {
      // 匿名访问：忽略无效令牌
    }
    return true;
  }
}

export const OptionalCurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): MiniappUser | undefined =>
    ctx.switchToHttp().getRequest().user,
);
