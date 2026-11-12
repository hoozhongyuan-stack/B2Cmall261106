import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';

import { permissionName, type PermissionKey } from '@shanye/shared';

import { PrismaService } from '../prisma/prisma.module';

export interface AuthUser {
  sub: string;
  account: string;
  name: string;
  kind: 'PC' | 'STORE';
  isSuper: boolean;
  roleId: string | null;
  roleName: string | null;
}

export const PERMISSION_KEY = 'permission';
export const Permission = (permission: PermissionKey) => SetMetadata(PERMISSION_KEY, permission);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('未登录或登录已失效');
    }
    try {
      req.user = await this.jwt.verifyAsync<AuthUser>(header.slice(7));
      return true;
    } catch {
      throw new UnauthorizedException('未登录或登录已失效');
    }
  }
}

interface CachedPermissions {
  permissions: string[];
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;

/**
 * 权限守卫：接口标注 @Permission 时按角色权限校验；未标注视为公开接口。
 * 超级管理员（isSuper）跳过校验。权限缓存 30 秒，角色保存时主动失效。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private static readonly cache = new Map<string, CachedPermissions>();

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  static invalidate(roleId?: string): void {
    if (roleId) RolesGuard.cache.delete(roleId);
    else RolesGuard.cache.clear();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user) throw new UnauthorizedException('未登录或登录已失效');
    if (user.isSuper) return true;
    if (!user.roleId) throw new ForbiddenException('当前账号未分配角色，请联系管理员');

    const permissions = await this.load(user.roleId);
    if (permissions.includes(required)) return true;
    throw new ForbiddenException(`缺少权限：${permissionName(required)}`);
  }

  private async load(roleId: string): Promise<string[]> {
    const now = Date.now();
    const cached = RolesGuard.cache.get(roleId);
    if (cached && cached.expiresAt > now) return cached.permissions;

    const role = await this.prisma.adminRoleDef.findUnique({
      where: { id: roleId },
      select: { permissions: true },
    });
    const permissions = role?.permissions ?? [];
    RolesGuard.cache.set(roleId, { permissions, expiresAt: now + CACHE_TTL_MS });
    return permissions;
  }
}
