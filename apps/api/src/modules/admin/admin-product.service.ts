import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService, isUniqueViolation } from '../../prisma/prisma.module';
import { buildProductSearchText } from '../../common/search-text';
import { AssetService } from '../assets/asset.service';

const SKU_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const PRODUCT_STATUSES = ['ON_SALE', 'OFF_SHELF', 'SOLD_OUT'];
const WRITABLE_PRODUCT_STATUSES = ['ON_SALE', 'OFF_SHELF'];

export interface AdminSkuInput {
  code?: string;
  specJson: Record<string, string>;
  priceCents: number;
  originCents?: number;
  pointsCost?: number;
  pointsMoneyCents?: number;
  stock: number;
  status?: string;
}

export interface CreateProductInput {
  title: string;
  subtitle?: string;
  categoryId: string;
  channel?: string;
  pointsLimitPerUser?: number;
  mainImageKey?: string;
  mainImageKeys?: string[];
  detailImageKeys?: string[];
  detail?: string;
  status?: string;
  sort?: number;
  skus: AdminSkuInput[];
}

export interface UpdateProductInput {
  title?: string;
  subtitle?: string;
  categoryId?: string;
  pointsLimitPerUser?: number;
  mainImageKey?: string;
  mainImageKeys?: string[];
  detailImageKeys?: string[];
  detail?: string;
  status?: string;
  sort?: number;
}

export interface UpdateSkuInput {
  priceCents?: number;
  originCents?: number;
  pointsCost?: number;
  pointsMoneyCents?: number;
  stock?: number;
  status?: string;
}

function generateSkuCode(): string {
  let suffix = '';
  for (let i = 0; i < 8; i += 1) {
    suffix += SKU_CODE_CHARS.charAt(Math.floor(Math.random() * SKU_CODE_CHARS.length));
  }
  return `SKU-${suffix}`;
}

@Injectable()
export class AdminProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetService,
  ) {}

  async listAdmin(query: {
    keyword?: string;
    status?: string;
    categoryId?: string;
    channel?: string;
    minPriceCents?: number;
    maxPriceCents?: number;
    sort?: string;
    page?: number;
    pageSize?: number;
  }) {
    const status = this.parseStatus(query.status, PRODUCT_STATUSES, '商品状态不合法');
    const channel = this.parseChannel(query.channel) ?? 'NORMAL';
    const keyword = query.keyword?.trim();
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);

    const orderBy =
      query.sort === 'price_asc'
        ? [{ priceMinCents: 'asc' as const }]
        : query.sort === 'price_desc'
          ? [{ priceMaxCents: 'desc' as const }]
          : query.sort === 'sales'
            ? [{ soldCount: 'desc' as const }]
            : query.sort === 'newest'
              ? [{ createdAt: 'desc' as const }]
              : [{ sort: 'asc' as const }, { createdAt: 'desc' as const }];

    const where = {
      ...(status ? { status: status as never } : {}),
      ...(channel ? { channel: channel as never } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(keyword ? { title: { contains: keyword, mode: 'insensitive' as const } } : {}),
      ...(query.minPriceCents !== undefined ? { priceMaxCents: { gte: query.minPriceCents } } : {}),
      ...(query.maxPriceCents !== undefined ? { priceMinCents: { lte: query.maxPriceCents } } : {}),
    };

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          category: true,
          skus: { select: { id: true, stock: true, pointsCost: true, pointsMoneyCents: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    // 积分商品补充「已兑数量」：统计未关闭/未退款的兑换单
    const exchanged = new Map<string, number>();
    if (channel === 'POINTS' && products.length > 0) {
      const skuToProduct = new Map(
        products.flatMap((p) => p.skus.map((sku) => [sku.id, p.id] as const)),
      );
      const rows = await this.prisma.orderItem.groupBy({
        by: ['skuId'],
        where: {
          skuId: { in: [...skuToProduct.keys()] },
          order: { orderType: 'POINTS', status: { notIn: ['CLOSED', 'REFUNDED'] } },
        },
        _sum: { quantity: true },
      });
      for (const row of rows) {
        const productId = skuToProduct.get(row.skuId);
        if (!productId) continue;
        exchanged.set(productId, (exchanged.get(productId) ?? 0) + (row._sum.quantity ?? 0));
      }
    }

    return {
      total,
      page,
      pageSize,
      items: products.map((p) => {
        const points = p.skus.map((sku) => sku.pointsCost).filter((v): v is number => v !== null);
        const pointsCostMin = points.length ? Math.min(...points) : null;
        const moneyOfMinPoints =
          pointsCostMin === null
            ? []
            : p.skus
                .filter((sku) => sku.pointsCost === pointsCostMin)
                .map((sku) => sku.pointsMoneyCents);
        return {
          id: p.id,
          title: p.title,
          status: p.status,
          channel: p.channel,
          categoryName: p.category.name,
          mainImageKey: p.mainImageKey,
          priceMinCents: p.priceMinCents,
          priceMaxCents: p.priceMaxCents,
          soldCount: p.soldCount,
          stock: p.skus.reduce((sum, sku) => sum + sku.stock, 0),
          skuCount: p.skus.length,
          pointsCostMin,
          pointsCostMax: points.length ? Math.max(...points) : null,
          pointsMoneyCentsMin: moneyOfMinPoints.length ? Math.min(...moneyOfMinPoints) : null,
          pointsLimitPerUser: p.pointsLimitPerUser,
          exchangedQty: exchanged.get(p.id) ?? 0,
          createdAt: p.createdAt,
        };
      }),
    };
  }

  /** 批量上下架：只更新存在的商品，返回实际影响行数 */
  async batchStatus(ids: string[], status: 'ON_SALE' | 'OFF_SHELF') {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) throw new BadRequestException('请选择商品');
    const result = await this.prisma.product.updateMany({
      where: { id: { in: unique } },
      data: { status },
    });
    return { total: unique.length, success: result.count, failed: unique.length - result.count };
  }

  /** 批量删除：逐条执行，已产生订单的商品记为失败并返回原因 */
  async batchRemove(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) throw new BadRequestException('请选择商品');
    const errors: { id: string; message: string }[] = [];
    let success = 0;
    for (const id of unique) {
      try {
        await this.remove(id);
        success += 1;
      } catch (error) {
        errors.push({ id, message: error instanceof Error ? error.message : '删除失败' });
      }
    }
    return { total: unique.length, success, failed: errors.length, errors };
  }

  async detail(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        skus: { orderBy: { priceCents: 'asc' } },
        category: true,
        tags: true,
      },
    });
    if (!product) throw new NotFoundException('商品不存在');
    return product;
  }

  async create(input: CreateProductInput) {
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('商品标题不能为空');
    if (!Array.isArray(input.skus) || input.skus.length === 0) {
      throw new BadRequestException('至少需要一个 SKU');
    }
    const status = this.parseStatus(input.status ?? 'OFF_SHELF', WRITABLE_PRODUCT_STATUSES, '商品状态不合法');
    const channel = this.parseChannel(input.channel) ?? 'NORMAL';
    const pointsLimitPerUser = this.nonNegativeInt(
      input.pointsLimitPerUser ?? 0,
      '每人限兑数量',
    );

    const category = await this.prisma.category.findUnique({ where: { id: input.categoryId } });
    if (!category) throw new NotFoundException('分类不存在');
    const gallery = await this.resolveGallery(input);
    const detailImageKeys = (await this.resolveDetailImages(input.detailImageKeys)) ?? [];

    const codes = new Set<string>();
    const skus = input.skus.map((sku, index) => {
      const position = `第 ${index + 1} 个 SKU`;
      const points = channel === 'POINTS' ? this.resolvePointsSku(sku, position) : null;
      const priceCents = points
        ? points.pointsMoneyCents
        : this.positiveInt(sku.priceCents, `${position} 价格`);
      const stock = this.nonNegativeInt(sku.stock, `${position} 库存`);
      const originCents =
        sku.originCents === undefined
          ? undefined
          : this.nonNegativeInt(sku.originCents, `${position} 划线价`);
      if (!sku.specJson || typeof sku.specJson !== 'object' || Array.isArray(sku.specJson)) {
        throw new BadRequestException(`${position} 规格不能为空`);
      }
      if (Object.keys(sku.specJson).length === 0) {
        throw new BadRequestException(`${position} 规格不能为空`);
      }

      const code = sku.code?.trim() || generateSkuCode();
      if (codes.has(code)) throw new BadRequestException('同商品内 SKU 编码不能重复');
      codes.add(code);

      return {
        code,
        specJson: sku.specJson,
        priceCents,
        originCents,
        pointsCost: points?.pointsCost ?? null,
        pointsMoneyCents: points?.pointsMoneyCents ?? 0,
        stock,
        status: (this.parseStatus(sku.status, PRODUCT_STATUSES, 'SKU 状态不合法') ??
          'ON_SALE') as never,
      };
    });

    const priceMinCents = Math.min(...skus.map((s) => s.priceCents));
    const priceMaxCents = Math.max(...skus.map((s) => s.priceCents));

    try {
      return await this.prisma.$transaction(async (tx) =>
        tx.product.create({
          data: {
            title,
            subtitle: input.subtitle,
            categoryId: input.categoryId,
            channel: channel as never,
            pointsLimitPerUser,
            searchText: buildProductSearchText({
              title,
              subtitle: input.subtitle,
              categoryName: category.name,
            }),
            mainImageKey: gallery.mainImageKey,
            mainImageKeys: gallery.mainImageKeys,
            detailImageKeys,
            detail: input.detail,
            status: status as never,
            sort: input.sort ?? 0,
            priceMinCents,
            priceMaxCents,
            skus: { create: skus },
          },
          include: { skus: true, category: true, tags: true },
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('SKU 编码已存在');
      throw err;
    }
  }

  async update(id: string, input: UpdateProductInput) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('商品不存在');

    const title = this.optionalText(input.title, '商品标题');
    if (input.categoryId !== undefined) {
      const category = await this.prisma.category.findUnique({ where: { id: input.categoryId } });
      if (!category) throw new NotFoundException('分类不存在');
    }
    if (input.sort !== undefined && !Number.isInteger(input.sort)) {
      throw new BadRequestException('排序必须为整数');
    }
    const status = this.parseStatus(input.status, WRITABLE_PRODUCT_STATUSES, '商品状态不合法');
    const pointsLimitPerUser =
      input.pointsLimitPerUser === undefined
        ? undefined
        : this.nonNegativeInt(input.pointsLimitPerUser, '每人限兑数量');
    const gallery =
      input.mainImageKeys !== undefined || input.mainImageKey !== undefined
        ? await this.resolveGallery(input)
        : null;
    const detailImageKeys = await this.resolveDetailImages(input.detailImageKeys);

    let searchText: string | undefined;
    if (title !== undefined || input.subtitle !== undefined || input.categoryId !== undefined) {
      const category = await this.prisma.category.findUnique({
        where: { id: input.categoryId ?? product.categoryId },
        select: { name: true },
      });
      const tags = await this.prisma.productTag.findMany({
        where: { productId: id },
        select: { name: true },
      });
      searchText = buildProductSearchText({
        title: title ?? product.title,
        subtitle: input.subtitle !== undefined ? input.subtitle : product.subtitle,
        categoryName: category?.name,
        tags: tags.map((tag) => tag.name),
      });
    }

    return this.prisma.product.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
        ...(searchText !== undefined ? { searchText } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(pointsLimitPerUser !== undefined ? { pointsLimitPerUser } : {}),
        ...(gallery
          ? { mainImageKey: gallery.mainImageKey, mainImageKeys: gallery.mainImageKeys }
          : {}),
        ...(detailImageKeys !== undefined ? { detailImageKeys } : {}),
        ...(input.detail !== undefined ? { detail: input.detail } : {}),
        ...(status !== undefined ? { status: status as never } : {}),
        ...(input.sort !== undefined ? { sort: input.sort } : {}),
      },
      include: { skus: true, category: true, tags: true },
    });
  }

  async updateSku(productId: string, skuId: string, input: UpdateSkuInput) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('商品不存在');

    const sku = await this.prisma.sku.findFirst({ where: { id: skuId, productId } });
    if (!sku) throw new NotFoundException('SKU 不存在');

    const isPoints = product.channel === 'POINTS';
    const priceCents =
      input.priceCents === undefined
        ? undefined
        : isPoints
          ? this.nonNegativeInt(input.priceCents, 'SKU 加价金额')
          : this.positiveInt(input.priceCents, 'SKU 价格');
    const pointsCost =
      input.pointsCost === undefined
        ? undefined
        : this.positiveInt(input.pointsCost, '兑换积分');
    const pointsMoneyCents =
      input.pointsMoneyCents === undefined
        ? undefined
        : this.nonNegativeInt(input.pointsMoneyCents, 'SKU 加价金额');
    const originCents =
      input.originCents === undefined
        ? undefined
        : this.nonNegativeInt(input.originCents, 'SKU 划线价');
    const stock =
      input.stock === undefined ? undefined : this.nonNegativeInt(input.stock, 'SKU 库存');
    const status = this.parseStatus(input.status, PRODUCT_STATUSES, 'SKU 状态不合法');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.sku.update({
        where: { id: skuId },
        data: {
          ...(priceCents !== undefined ? { priceCents } : {}),
          ...(pointsMoneyCents !== undefined
            ? { pointsMoneyCents, priceCents: pointsMoneyCents }
            : isPoints && priceCents !== undefined
              ? { pointsMoneyCents: priceCents }
              : {}),
          ...(pointsCost !== undefined ? { pointsCost } : {}),
          ...(originCents !== undefined ? { originCents } : {}),
          ...(stock !== undefined ? { stock } : {}),
          ...(status !== undefined ? { status: status as never } : {}),
        },
      });

      // 改价后重算商品价格区间，列表与详情才能同步
      if (priceCents !== undefined || pointsMoneyCents !== undefined) {
        const agg = await tx.sku.aggregate({
          where: { productId },
          _min: { priceCents: true },
          _max: { priceCents: true },
        });
        await tx.product.update({
          where: { id: productId },
          data: {
            priceMinCents: agg._min.priceCents ?? priceCents,
            priceMaxCents: agg._max.priceCents ?? priceCents,
          },
        });
      }

      return updated;
    });
  }

  async updateTags(productId: string, tagIds: string[]) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('商品不存在');

    const ids = [...new Set(tagIds)];

    return this.prisma.$transaction(async (tx) => {
      const tags = await tx.productTag.findMany({ where: { id: { in: ids } } });
      if (tags.length !== ids.length) throw new NotFoundException('标签不存在');

      const occupied = tags.find((t) => t.productId !== null && t.productId !== productId);
      if (occupied) throw new ConflictException(`标签「${occupied.name}」已被其它商品占用`);

      await tx.productTag.updateMany({
        where: { productId, id: { notIn: ids } },
        data: { productId: null },
      });
      await tx.productTag.updateMany({
        where: { id: { in: ids } },
        data: { productId },
      });

      const assigned = await tx.productTag.findMany({
        where: { productId },
        orderBy: { name: 'asc' },
      });
      const category = await tx.category.findUnique({
        where: { id: product.categoryId },
        select: { name: true },
      });
      await tx.product.update({
        where: { id: productId },
        data: {
          searchText: buildProductSearchText({
            title: product.title,
            subtitle: product.subtitle,
            categoryName: category?.name,
            tags: assigned.map((tag) => tag.name),
          }),
        },
      });
      return { items: assigned.map((t) => ({ id: t.id, name: t.name })) };
    });
  }

  async remove(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { skus: { select: { id: true } } },
    });
    if (!product) throw new NotFoundException('商品不存在');

    const skuIds = product.skus.map((s) => s.id);
    if (skuIds.length > 0) {
      const ordered = await this.prisma.orderItem.count({ where: { skuId: { in: skuIds } } });
      if (ordered > 0) throw new ConflictException('已产生订单的商品只能下架');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({ where: { skuId: { in: skuIds } } });
      await tx.productTag.updateMany({ where: { productId: id }, data: { productId: null } });
      await tx.sku.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
    });

    return { deleted: true };
  }

  /** 主图：优先数组，兼容旧的单图字段；首张同步到 mainImageKey */
  private async resolveGallery(input: {
    mainImageKeys?: string[];
    mainImageKey?: string;
  }): Promise<{ mainImageKeys: string[]; mainImageKey: string | null }> {
    const raw = input.mainImageKeys ?? (input.mainImageKey ? [input.mainImageKey] : []);
    const keys = raw.map((key) => key.trim()).filter(Boolean);
    await this.assets.assertReferences(keys);
    return { mainImageKeys: keys, mainImageKey: keys[0] ?? null };
  }

  /** 详情图：保持顺序，逐张校验素材来源 */
  private async resolveDetailImages(keys: string[] | undefined): Promise<string[] | undefined> {
    if (keys === undefined) return undefined;
    const cleaned = keys.map((key) => key.trim()).filter(Boolean);
    await this.assets.assertReferences(cleaned);
    return cleaned;
  }

  private parseChannel(value: string | undefined): 'NORMAL' | 'POINTS' | undefined {
    if (value === undefined || value === '') return undefined;
    if (value !== 'NORMAL' && value !== 'POINTS') {
      throw new BadRequestException('商品渠道不合法');
    }
    return value;
  }

  /** 积分商品 SKU：兑换积分必填，加价金额可 0；价格字段与加价保持同步 */
  private resolvePointsSku(
    sku: AdminSkuInput,
    position: string,
  ): { pointsCost: number; pointsMoneyCents: number } {
    const pointsCostRaw = sku.pointsCost ?? 0;
    if (!Number.isInteger(pointsCostRaw) || pointsCostRaw <= 0) {
      throw new BadRequestException(`${position} 兑换积分必须为正整数`);
    }
    const pointsMoneyCents = this.nonNegativeInt(
      sku.pointsMoneyCents ?? 0,
      `${position} 加价金额`,
    );
    return { pointsCost: pointsCostRaw, pointsMoneyCents };
  }

  private parseStatus(
    value: string | undefined,
    allowed: string[],
    message: string,
  ): string | undefined {
    if (value === undefined || value === '') return undefined;
    if (!allowed.includes(value)) throw new BadRequestException(message);
    return value;
  }

  private positiveInt(value: number, label: string): number {
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${label}必须为正整数分`);
    }
    return value;
  }

  private nonNegativeInt(value: number, label: string): number {
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${label}必须为非负整数`);
    }
    return value;
  }

  private optionalText(value: string | undefined, label: string): string | undefined {
    if (value === undefined) return undefined;
    const text = value.trim();
    if (!text) throw new BadRequestException(`${label}不能为空`);
    return text;
  }
}
