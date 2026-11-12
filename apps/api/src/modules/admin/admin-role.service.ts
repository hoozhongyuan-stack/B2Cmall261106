import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  PERMISSION_DEPENDENCIES,
  isPermissionKey,
  permissionName,
  type PermissionKey,
} from '@shanye/shared';

import { PrismaService, isUniqueViolation } from '../../prisma/prisma.module';
import { RolesGuard } from '../../common/auth.guards';

export interface RoleInput {
  name: string;
  description: string;
  permissions: string[];
}

@Injectable()
export class AdminRoleService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const items = await this.prisma.adminRoleDef.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { users: true } } },
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        permissions: item.permissions,
        permissionCount: item.permissions.length,
        memberCount: item._count.users,
        updatedAt: item.updatedAt,
      })),
    };
  }

  async detail(id: string) {
    const role = await this.prisma.adminRoleDef.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('角色不存在');
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      permissions: role.permissions,
      permissionCount: role.permissions.length,
      memberCount: role._count.users,
      updatedAt: role.updatedAt,
    };
  }

  async create(input: RoleInput) {
    const permissions = this.normalizePermissions(input.permissions);
    try {
      const role = await this.prisma.adminRoleDef.create({
        data: {
          name: input.name.trim(),
          description: input.description.trim(),
          permissions,
        },
        include: { _count: { select: { users: true } } },
      });
      return this.detail(role.id);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('角色名称已存在');
      throw err;
    }
  }

  async update(id: string, input: RoleInput) {
    const exists = await this.prisma.adminRoleDef.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('角色不存在');

    const permissions = this.normalizePermissions(input.permissions);
    try {
      await this.prisma.adminRoleDef.update({
        where: { id },
        data: {
          name: input.name.trim(),
          description: input.description.trim(),
          permissions,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('角色名称已存在');
      throw err;
    }
    RolesGuard.invalidate(id);
    return this.detail(id);
  }

  async remove(id: string) {
    const role = await this.prisma.adminRoleDef.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('角色不存在');
    if (role._count.users > 0) {
      throw new ConflictException(`该角色下还有 ${role._count.users} 个账号，请先调整账号角色`);
    }
    await this.prisma.adminRoleDef.delete({ where: { id } });
    RolesGuard.invalidate(id);
    return { id };
  }

  /** 去重、校验目录合法性，并补齐写权限依赖的查看权限 */
  private normalizePermissions(input: string[]): PermissionKey[] {
    const keys = [...new Set(input.map((key) => key.trim()).filter(Boolean))];
    if (!keys.length) throw new BadRequestException('请至少选择一项权限');

    const invalid = keys.filter((key) => !isPermissionKey(key));
    if (invalid.length) {
      throw new BadRequestException(`未知权限：${invalid.map(permissionName).join('、')}`);
    }

    const result = new Set<PermissionKey>(keys as PermissionKey[]);
    for (const key of [...result]) {
      for (const dependency of PERMISSION_DEPENDENCIES[key] ?? []) result.add(dependency);
    }
    return [...result];
  }
}
