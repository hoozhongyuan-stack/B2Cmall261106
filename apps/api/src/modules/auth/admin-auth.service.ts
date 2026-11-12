import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { ALL_PERMISSIONS } from '@shanye/shared';

import { PrismaService } from '../../prisma/prisma.module';
import { verifyPassword } from '../../common/password';

const MAX_FAIL = 5;
const LOCK_MINUTES = 15;

const ADMIN_USER_SELECT = {
  id: true,
  account: true,
  displayName: true,
  kind: true,
  isSuper: true,
  roleId: true,
  role: { select: { id: true, name: true, permissions: true } },
} as const;

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(account: string, password: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { account },
      include: { role: { select: { id: true, name: true, permissions: true } } },
    });
    if (!admin) throw new UnauthorizedException('账号或密码错误');

    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new UnauthorizedException('账号已锁定，请稍后再试');
    }

    if (!verifyPassword(password, admin.passwordHash)) {
      const failCount = admin.failCount + 1;
      await this.prisma.adminUser.update({
        where: { id: admin.id },
        data: {
          failCount,
          lockedUntil:
            failCount >= MAX_FAIL ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      const remain = Math.max(MAX_FAIL - failCount, 0);
      throw new UnauthorizedException(
        remain > 0 ? `账号或密码错误，还可尝试 ${remain} 次` : '账号已锁定，请稍后再试',
      );
    }

    // 门店业务已迁移到小程序「我的 → 门店中心」，PC 不再接受门店账号登录
    if (admin.kind === 'STORE') {
      throw new ForbiddenException('门店操作请使用小程序「我的 → 门店中心」，PC 后台不再支持门店账号登录');
    }

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { failCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const permissions = admin.isSuper
      ? [...ALL_PERMISSIONS]
      : (admin.role?.permissions ?? []);

    const payload = {
      sub: admin.id,
      account: admin.account,
      name: admin.displayName,
      kind: admin.kind,
      isSuper: admin.isSuper,
      roleId: admin.roleId,
      roleName: admin.role?.name ?? null,
    };
    return {
      token: await this.jwt.signAsync(payload),
      user: this.view(admin, permissions),
    };
  }

  async me(userId: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: userId },
      select: ADMIN_USER_SELECT,
    });
    if (!admin) throw new UnauthorizedException('登录已失效');
    if (admin.kind === 'STORE') {
      throw new ForbiddenException('门店账号请使用小程序门店中心');
    }
    const permissions = admin.isSuper
      ? [...ALL_PERMISSIONS]
      : (admin.role?.permissions ?? []);
    return this.view(admin, permissions);
  }

  private view(
    admin: {
      id: string;
      account: string;
      displayName: string;
      isSuper: boolean;
      roleId: string | null;
      role: { id: string; name: string; permissions: string[] } | null;
    },
    permissions: string[],
  ) {
    return {
      id: admin.id,
      account: admin.account,
      name: admin.displayName,
      isSuper: admin.isSuper,
      role: admin.role ? { id: admin.role.id, name: admin.role.name } : null,
      permissions,
    };
  }
}
