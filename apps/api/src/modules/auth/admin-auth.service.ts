import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.module';
import { verifyPassword } from '../../common/password';

const MAX_FAIL = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(account: string, password: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { account } });
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

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { failCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    // 门店业务已迁移到小程序「我的 → 门店中心」，PC 不再接受门店账号登录
    if (admin.role === 'STORE') {
      throw new ForbiddenException('门店操作请使用小程序「我的 → 门店中心」，PC 后台不再支持门店账号登录');
    }

    const payload = {
      sub: admin.id,
      account: admin.account,
      role: admin.role,
      name: admin.displayName,
    };
    return {
      token: await this.jwt.signAsync(payload),
      user: { id: admin.id, name: admin.displayName, role: admin.role },
    };
  }
}
