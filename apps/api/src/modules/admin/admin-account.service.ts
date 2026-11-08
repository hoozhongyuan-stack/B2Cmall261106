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
  adminStores: { select: { storeId: true } },
} as const;

export type AccountStatus = 'ACTIVE' | 'DISABLED';

export interface CreateAccountInput {
  account: string;
  displayName: string;
  role: AdminRole;
  password: string;
  storeIds?: string[];
}

export interface UpdateAccountInput {
  displayName?: string;
  role?: AdminRole;
  storeIds?: string[];
}

@Injectable()
export class AdminAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const items = await this.prisma.adminUser.findMany({
      select: ACCOUNT_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return { items: items.map((item) => this.view(item)) };
  }

  async create(input: CreateAccountInput) {
    this.assertPassword(input.password);
    const storeIds = await this.storeIdsFor(input.role, input.storeIds);

    const exists = await this.prisma.adminUser.findUnique({
      where: { account: input.account },
      select: { id: true },
    });
    if (exists) throw new ConflictException('账号已存在');

    try {
      const row = await this.prisma.adminUser.create({
        data: {
          account: input.account,
          displayName: input.displayName,
          role: input.role,
          passwordHash: hashPassword(input.password),
          ...(storeIds.length
            ? { adminStores: { create: storeIds.map((storeId) => ({ storeId })) } }
            : {}),
        },
        select: ACCOUNT_SELECT,
      });
      return this.view(row);
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

    const nextRole = input.role ?? target.role;
    let storeIds: string[] | undefined;
    if (input.storeIds !== undefined) {
      storeIds = await this.storeIdsFor(nextRole, input.storeIds);
    } else if (input.role !== undefined && nextRole !== 'STORE') {
      storeIds = [];
    } else if (input.role !== undefined && nextRole === 'STORE' && target.role !== 'STORE') {
      throw new BadRequestException('门店账号至少绑定一个门店');
    }

    const row = await this.prisma.adminUser.update({
      where: { id },
      data: {
        displayName: input.displayName,
        role: input.role,
        ...(storeIds !== undefined
          ? {
              adminStores: {
                deleteMany: {},
                create: storeIds.map((storeId) => ({ storeId })),
              },
            }
          : {}),
      },
      select: ACCOUNT_SELECT,
    });
    return this.view(row);
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

  /** 门店账号至少绑定一个启用中的门店；其他角色不允许绑定门店 */
  private async storeIdsFor(role: AdminRole, input?: string[]): Promise<string[]> {
    const ids = [...new Set((input ?? []).map((value) => value.trim()).filter(Boolean))];
    if (role !== 'STORE') {
      if (ids.length) throw new BadRequestException('只有门店账号可以绑定门店');
      return [];
    }
    if (!ids.length) throw new BadRequestException('门店账号至少绑定一个门店');

    const count = await this.prisma.store.count({
      where: { id: { in: ids }, status: 'ACTIVE' },
    });
    if (count !== ids.length) throw new BadRequestException('门店不存在或已停用');
    return ids;
  }

  private view<T extends { adminStores: { storeId: string }[] }>(row: T) {
    const { adminStores, ...rest } = row;
    return { ...rest, storeIds: adminStores.map((item) => item.storeId) };
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
