import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService, isUniqueViolation } from '../../prisma/prisma.module';
import { hashPassword } from '../../common/password';

export type AccountStatus = 'ACTIVE' | 'DISABLED';
export type AccountKind = 'PC' | 'STORE';

const ACCOUNT_SELECT = {
  id: true,
  account: true,
  displayName: true,
  kind: true,
  isSuper: true,
  roleId: true,
  role: { select: { id: true, name: true } },
  status: true,
  failCount: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  adminStores: { select: { storeId: true } },
} as const;

export interface CreateAccountInput {
  account: string;
  displayName: string;
  kind?: AccountKind;
  roleId?: string;
  password: string;
  storeIds?: string[];
}

export interface UpdateAccountInput {
  displayName?: string;
  kind?: AccountKind;
  roleId?: string;
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
    const kind = input.kind ?? 'PC';
    const storeIds = await this.storeIdsFor(kind, input.storeIds);
    const roleId = await this.roleIdFor(kind, input.roleId);

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
          kind,
          roleId,
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
      select: { id: true, kind: true, isSuper: true, roleId: true, status: true },
    });
    if (!target) throw new NotFoundException('子账号不存在');

    if (target.isSuper && (input.kind !== undefined || input.roleId !== undefined)) {
      throw new BadRequestException('超级管理员账号不支持修改账号类型或角色');
    }

    const nextKind = input.kind ?? target.kind;
    const nextRoleId =
      input.roleId !== undefined ? input.roleId : target.roleId;

    if (input.kind !== undefined && nextKind !== target.kind) {
      if (target.isSuper) throw new BadRequestException('超级管理员账号不可转为门店账号');
    }

    let storeIds: string[] | undefined;
    if (input.storeIds !== undefined || input.kind !== undefined) {
      storeIds = await this.storeIdsFor(nextKind, input.storeIds);
    }

    const roleId = await this.roleIdFor(nextKind, nextRoleId);

    const row = await this.prisma.adminUser.update({
      where: { id },
      data: {
        displayName: input.displayName,
        ...(input.kind !== undefined ? { kind: nextKind } : {}),
        ...(input.kind !== undefined || input.roleId !== undefined ? { roleId } : {}),
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
      select: { id: true, isSuper: true, status: true },
    });
    if (!target) throw new NotFoundException('子账号不存在');

    if (status === 'DISABLED') {
      if (id === operatorId) throw new BadRequestException('不能停用当前登录账号');
      if (target.isSuper && target.status === 'ACTIVE') {
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

  /** 门店账号至少绑定一个启用中的门店；PC 账号不允许绑定门店 */
  private async storeIdsFor(kind: AccountKind, input?: string[]): Promise<string[]> {
    const ids = [...new Set((input ?? []).map((value) => value.trim()).filter(Boolean))];
    if (kind !== 'STORE') {
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

  /** PC 账号必须绑定存在的角色；门店账号不绑定角色 */
  private async roleIdFor(
    kind: AccountKind,
    roleId: string | undefined | null,
  ): Promise<string | null> {
    if (kind === 'STORE') return null;
    if (!roleId) throw new BadRequestException('请选择角色');
    const role = await this.prisma.adminRoleDef.findUnique({
      where: { id: roleId },
      select: { id: true },
    });
    if (!role) throw new BadRequestException('角色不存在');
    return roleId;
  }

  private view<T extends { adminStores: { storeId: string }[]; role: { id: string; name: string } | null }>(
    row: T,
  ) {
    const { adminStores, role, ...rest } = row;
    return {
      ...rest,
      roleId: role?.id ?? null,
      roleName: role?.name ?? null,
      storeIds: adminStores.map((item) => item.storeId),
    };
  }

  private assertPassword(password: string): void {
    if (!password || password.length < 8) {
      throw new BadRequestException('密码至少 8 位');
    }
  }

  private async assertNotLastActiveSuper(message: string): Promise<void> {
    const activeSuperCount = await this.prisma.adminUser.count({
      where: { isSuper: true, status: 'ACTIVE' },
    });
    if (activeSuperCount <= 1) throw new ConflictException(message);
  }
}
