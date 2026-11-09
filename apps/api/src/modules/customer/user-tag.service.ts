import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.module';

export interface TagView {
  id: string;
  name: string;
  parentId: string | null;
  sort: number;
  userCount: number;
  children?: TagView[];
}

/**
 * 用户标签：两级标签树 + 用户批量打标。
 * 一级标签可挂二级；二级不可再挂，删除标签级联删除下级与绑定关系。
 */
@Injectable()
export class UserTagService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const [tags, counts] = await Promise.all([
      this.prisma.userTag.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.userTagLink.groupBy({ by: ['tagId'], _count: { _all: true } }),
    ]);
    const countOf = new Map(counts.map((item) => [item.tagId, item._count._all]));
    const childMap = new Map<string, TagView[]>();

    for (const tag of tags) {
      if (!tag.parentId) continue;
      const list = childMap.get(tag.parentId) ?? [];
      list.push({
        id: tag.id,
        name: tag.name,
        parentId: tag.parentId,
        sort: tag.sort,
        userCount: countOf.get(tag.id) ?? 0,
      });
      childMap.set(tag.parentId, list);
    }

    const items: TagView[] = tags
      .filter((tag) => !tag.parentId)
      .map((tag) => ({
        id: tag.id,
        name: tag.name,
        parentId: null,
        sort: tag.sort,
        userCount: countOf.get(tag.id) ?? 0,
        children: childMap.get(tag.id) ?? [],
      }));

    return { items, total: tags.length };
  }

  /** 只返回扁平列表，供下拉选择使用 */
  async options() {
    const tags = await this.prisma.userTag.findMany({
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      include: { parent: { select: { name: true } } },
    });
    return {
      items: tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        parentId: tag.parentId,
        parentName: tag.parent?.name ?? null,
      })),
    };
  }

  async create(input: { name?: string; parentId?: string | null }) {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('标签名称不能为空');
    if (name.length > 20) throw new BadRequestException('标签名称最多 20 个字');

    let parentId: string | null = null;
    if (input.parentId) {
      const parent = await this.prisma.userTag.findUnique({ where: { id: input.parentId } });
      if (!parent) throw new NotFoundException('上级标签不存在');
      if (parent.parentId) throw new BadRequestException('标签最多支持两级');
      parentId = parent.id;
    }

    await this.assertUnique(name, parentId);
    return this.prisma.userTag.create({ data: { name, parentId } });
  }

  async update(id: string, input: { name?: string; sort?: number }) {
    const tag = await this.prisma.userTag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('标签不存在');

    const data: { name?: string; sort?: number } = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('标签名称不能为空');
      if (name.length > 20) throw new BadRequestException('标签名称最多 20 个字');
      await this.assertUnique(name, tag.parentId, tag.id);
      data.name = name;
    }
    if (input.sort !== undefined) data.sort = input.sort;

    return this.prisma.userTag.update({ where: { id }, data });
  }

  async remove(id: string) {
    const tag = await this.prisma.userTag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('标签不存在');
    await this.prisma.userTag.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * 批量打标：add 追加、remove 移除、replace 覆盖（tagIds 为空即清空）。
   */
  async assign(input: {
    userIds: string[];
    tagIds?: string[];
    mode?: 'add' | 'remove' | 'replace';
  }) {
    const userIds = [...new Set((input.userIds ?? []).filter(Boolean))];
    const tagIds = [...new Set((input.tagIds ?? []).filter(Boolean))];
    const mode = input.mode ?? 'add';

    if (!userIds.length) throw new BadRequestException('请选择客户');
    if (mode !== 'replace' && !tagIds.length) throw new BadRequestException('请选择标签');

    const [userCount, tagCount] = await Promise.all([
      this.prisma.user.count({ where: { id: { in: userIds } } }),
      tagIds.length
        ? this.prisma.userTag.count({ where: { id: { in: tagIds } } })
        : Promise.resolve(0),
    ]);
    if (userCount !== userIds.length) throw new BadRequestException('存在无效客户');
    if (tagIds.length && tagCount !== tagIds.length) throw new BadRequestException('存在无效标签');

    if (mode === 'add') {
      await this.prisma.userTagLink.createMany({
        data: userIds.flatMap((userId) => tagIds.map((tagId) => ({ userId, tagId }))),
        skipDuplicates: true,
      });
    } else if (mode === 'remove') {
      await this.prisma.userTagLink.deleteMany({
        where: { userId: { in: userIds }, tagId: { in: tagIds } },
      });
    } else {
      await this.prisma.$transaction([
        this.prisma.userTagLink.deleteMany({ where: { userId: { in: userIds } } }),
        ...(tagIds.length
          ? [
              this.prisma.userTagLink.createMany({
                data: userIds.flatMap((userId) => tagIds.map((tagId) => ({ userId, tagId }))),
                skipDuplicates: true,
              }),
            ]
          : []),
      ]);
    }

    return { users: userIds.length, tags: tagIds.length, mode };
  }

  private async assertUnique(name: string, parentId: string | null, excludeId?: string) {
    const exists = await this.prisma.userTag.findFirst({
      where: {
        parentId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (exists) throw new ConflictException('同级下已有同名标签');
  }
}
