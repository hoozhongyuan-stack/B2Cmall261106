import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService, isUniqueViolation } from '../../prisma/prisma.module';
import { AssetService } from '../assets/asset.service';

export interface CreateCategoryInput {
  name: string;
  iconKey?: string | null;
  parentId?: string;
  sort?: number;
}

export interface UpdateCategoryInput {
  name?: string;
  iconKey?: string | null;
  parentId?: string | null;
  sort?: number;
}

@Injectable()
export class AdminTaxonomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetService,
  ) {}

  /* ---------------- 分类 ---------------- */

  /** 分类树：最多两级，productCount 为分类下商品数 */
  async categoryTree() {
    const roots = await this.prisma.category.findMany({
      where: { parentId: null },
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { products: true } },
        children: {
          orderBy: [{ sort: 'asc' }, { name: 'asc' }],
          include: { _count: { select: { products: true } } },
        },
      },
    });

    return roots.map((root) => ({
      id: root.id,
      name: root.name,
      iconKey: root.iconKey,
      parentId: root.parentId,
      sort: root.sort,
      productCount: root._count.products,
      children: root.children.map((child) => ({
        id: child.id,
        name: child.name,
        iconKey: child.iconKey,
        parentId: child.parentId,
        sort: child.sort,
        productCount: child._count.products,
        children: [],
      })),
    }));
  }

  async createCategory(input: CreateCategoryInput) {
    const name = this.requireName(input.name, '分类名称');
    this.assertSort(input.sort);
    const iconKey = await this.iconKeyOf(input.iconKey);

    const parentId = input.parentId?.trim();
    if (input.parentId !== undefined && !parentId) {
      throw new BadRequestException('父分类不合法');
    }
    if (parentId) {
      const parent = await this.prisma.category.findUnique({ where: { id: parentId } });
      if (!parent) throw new NotFoundException('父分类不存在');
      if (parent.parentId) throw new BadRequestException('分类最多两级');
    }

    return this.prisma.category.create({
      data: { name, iconKey, parentId: parentId ?? null, sort: input.sort ?? 0 },
    });
  }

  async updateCategory(id: string, input: UpdateCategoryInput) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { children: true } } },
    });
    if (!category) throw new NotFoundException('分类不存在');

    const name = input.name === undefined ? undefined : this.requireName(input.name, '分类名称');
    this.assertSort(input.sort);
    const iconKey =
      input.iconKey === undefined ? undefined : await this.iconKeyOf(input.iconKey);

    if (input.parentId !== undefined) {
      if (input.parentId === id) throw new BadRequestException('不能把分类挂到自己下');
      if (input.parentId === '') throw new BadRequestException('父分类不合法');
      if (input.parentId) {
        if (category._count.children > 0) {
          throw new BadRequestException('存在子分类的分类不能挂到其它分类下');
        }
        const parent = await this.prisma.category.findUnique({ where: { id: input.parentId } });
        if (!parent) throw new NotFoundException('父分类不存在');
        if (parent.parentId) throw new BadRequestException('分类最多两级');
      }
    }

    return this.prisma.category.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(iconKey !== undefined ? { iconKey } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.sort !== undefined ? { sort: input.sort } : {}),
      },
    });
  }

  async removeCategory(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { children: true, products: true } } },
    });
    if (!category) throw new NotFoundException('分类不存在');
    if (category._count.children > 0) throw new ConflictException('该分类下还有子分类，不能删除');
    if (category._count.products > 0) throw new ConflictException('该分类下还有商品，不能删除');

    await this.prisma.category.delete({ where: { id } });
    return { deleted: true };
  }

  /* ---------------- 标签 ---------------- */

  async listTags() {
    const tags = await this.prisma.productTag.findMany({
      orderBy: { name: 'asc' },
      include: { product: { select: { title: true } } },
    });
    return tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      productId: tag.productId,
      productTitle: tag.product?.title ?? null,
    }));
  }

  async createTag(input: { name: string }) {
    const name = this.requireName(input.name, '标签名称');
    if (await this.prisma.productTag.findUnique({ where: { name } })) {
      throw new ConflictException('标签名称已存在');
    }

    try {
      return await this.prisma.productTag.create({ data: { name } });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('标签名称已存在');
      throw err;
    }
  }

  async updateTag(id: string, input: { name: string }) {
    const tag = await this.prisma.productTag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('标签不存在');

    const name = this.requireName(input.name, '标签名称');
    const duplicate = await this.prisma.productTag.findUnique({ where: { name } });
    if (duplicate && duplicate.id !== id) throw new ConflictException('标签名称已存在');

    try {
      return await this.prisma.productTag.update({ where: { id }, data: { name } });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('标签名称已存在');
      throw err;
    }
  }

  async removeTag(id: string) {
    const tag = await this.prisma.productTag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('标签不存在');
    await this.prisma.productTag.delete({ where: { id } });
    return { deleted: true };
  }

  private requireName(value: string, label: string): string {
    const name = value?.trim();
    if (!name) throw new BadRequestException(`${label}不能为空`);
    return name;
  }

  private assertSort(value: number | undefined): void {
    if (value !== undefined && !Number.isInteger(value)) {
      throw new BadRequestException('排序必须为整数');
    }
  }

  /** 分类图标：允许留空；填写时必须来自素材库 */
  private async iconKeyOf(value: string | null | undefined): Promise<string | null> {
    const key = (value ?? '').trim();
    if (!key) return null;
    await this.assets.assertReference(key);
    return key;
  }
}
