import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.module';
import type { AuthUser } from '../../common/auth.guards';

export interface StoreScope {
  /** 总部账号：全部门店 */
  all: boolean;
  storeIds: string[];
}

/**
 * 门店数据范围：总部角色全量，STORE 角色只允许访问 AdminStore 授权门店。
 * 所有门店相关接口都必须在 service 层调用，不能只靠前端隐藏。
 */
@Injectable()
export class StoreScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(user: AuthUser): Promise<StoreScope> {
    if (user.role !== 'STORE') return { all: true, storeIds: [] };

    const rows = await this.prisma.adminStore.findMany({
      where: { adminUserId: user.sub },
      select: { storeId: true },
    });
    return { all: false, storeIds: rows.map((row) => row.storeId) };
  }

  assertAccess(scope: StoreScope, storeId: string): void {
    if (!scope.all && !scope.storeIds.includes(storeId)) {
      throw new NotFoundException('门店不存在');
    }
  }
}
