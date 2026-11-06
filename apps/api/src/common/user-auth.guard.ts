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
