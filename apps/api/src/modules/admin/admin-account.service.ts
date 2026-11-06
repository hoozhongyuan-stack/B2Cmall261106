import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService, isUniqueViolation } from '../../prisma/prisma.module';
import { hashPassword } from '../../common/password';
import type { AdminRole } from '../../common/auth.guards';

const ACCOUNT_SELECT = {
  id: true,
  account: true,
  displayName: true,
  role: true,
  status: true,
  failCount: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

export type AccountStatus = 'ACTIVE' | 'DISABLED';

export interface CreateAccountInput {
  account: string;
  displayName: string;
  role: AdminRole;
  password: string;
}

export interface UpdateAccountInput {
  displayName?: string;
  role?: AdminRole;
}

@Injectable()
export class AdminAccountService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.adminUser
      .findMany({ select: ACCOUNT_SELECT, orderBy: { createdAt: 'desc' } })
      .then((items) => ({ items }));
  }

  async create(input: CreateAccountInput) {
    this.assertPassword(input.password);

    const exists = await this.prisma.adminUser.findUnique({
      where: { account: input.account },
      select: { id: true },
    });
    if (exists) throw new ConflictException('账号已存在');

    try {
      return await this.prisma.adminUser.create({
        data: {
          account: input.account,
          displayName: input.displayName,
          role: input.role,
          passwordHash: hashPassword(input.password),
        },
        select: ACCOUNT_SELECT,
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('账号已存在');
      throw err;
    }
  }

  async update(id: string, input: UpdateAccountInput) {
    const target = await this.prisma.adminUser.findUnique({
      where: { id },
      select: { id: true, role: true, status: true },
    });
    if (!target) throw new NotFoundException('子账号不存在');

    if (input.role && input.role !== target.role && target.role === 'SUPER' && target.status === 'ACTIVE') {
      await this.assertNotLastActiveSuper('不能降级最后一个启用中的超级管理员');
    }

    return this.prisma.adminUser.update({
      where: { id },
      data: { displayName: input.displayName, role: input.role },
      select: ACCOUNT_SELECT,
    });
  }

  async setStatus(id: string, status: AccountStatus, operatorId: string) {
    const target = await this.prisma.adminUser.findUnique({
      where: { id },
      select: { id: true, role: true, status: true },
    });
    if (!target) throw new NotFoundException('子账号不存在');

    if (status === 'DISABLED') {
      if (id === operatorId) throw new BadRequestException('不能停用当前登录账号');
      if (target.role === 'SUPER' && target.status === 'ACTIVE') {
        await this.assertNotLastActiveSuper('不能停用最后一个启用中的超级管理员');
      }
    }

    return this.prisma.adminUser.update({
      where: { id },
      data: { status },
      select: ACCOUNT_SELECT,
    });
  }

  async resetPassword(id: string, password: string) {
    this.assertPassword(password);

    const target = await this.prisma.adminUser.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('子账号不存在');

    await this.prisma.adminUser.update({
      where: { id },
      data: { passwordHash: hashPassword(password), failCount: 0, lockedUntil: null },
    });

    return { id };
  }

  private assertPassword(password: string): void {
    if (!password || password.length < 8) {
      throw new BadRequestException('密码至少 8 位');
    }
  }

  private async assertNotLastActiveSuper(message: string): Promise<void> {
    const activeSuperCount = await this.prisma.adminUser.count({
      where: { role: 'SUPER', status: 'ACTIVE' },
    });
    if (activeSuperCount <= 1) throw new ConflictException(message);
  }
}
