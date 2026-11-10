import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../../prisma/prisma.module';
import { ProductSort, searchProducts } from '../../prisma/search';
import { SearchLogService } from '../search/search-log.service';
import {
  MiniappUser,
  OptionalCurrentUser,
  OptionalUserJwtGuard,
} from '../../common/user-auth.guard';

const PRODUCT_SORTS: ProductSort[] = ['default', 'sales', 'price_asc', 'price_desc', 'new'];

function parseCents(value: string | undefined, label: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestException(`${label}必须为非负整数（分）`);
  }
  return parsed;
}

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly searchLogs: SearchLogService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: '健康检查（含数据库连通性）' })
  async health() {
    const db = await this.prisma.ping();
    return { status: db ? 'ok' : 'degraded', db, uptimeSec: Math.round(process.uptime()) };
  }

  @Get('shop')
  @ApiOperation({ summary: '店铺配置（包邮门槛、运费、售后期）' })
  async shop() {
    const config = await this.prisma.shopConfig.findFirst();
    return {
      shopName: config?.shopName ?? '山野',
      intro: config?.intro ?? '',
      servicePhone: config?.servicePhone ?? null,
      freeThresholdCents: config?.freeThresholdCents ?? 9900,
      flatFreightCents: config?.flatFreightCents ?? 1000,
      afterSaleDays: config?.afterSaleDays ?? 7,
    };
  }

  @Get('categories')
  @ApiOperation({ summary: '分类树（含商品数）' })
  async categories() {
    const list = await this.prisma.category.findMany({
      where: { parentId: null },
      orderBy: { sort: 'asc' },
      include: {
        children: { orderBy: { sort: 'asc' } },
        _count: { select: { products: true } },
      },
    });
    return list.map((c) => ({
      id: c.id,
      name: c.name,
      productCount: c._count.products,
      children: c.children.map((child) => ({ id: child.id, name: child.name })),
    }));
  }

  @Get('tags')
  @ApiOperation({ summary: '标签列表（仅包含在售商品）' })
  async tags() {
    return this.prisma.productTag.findMany({
      where: { product: { status: 'ON_SALE' } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
      take: 50,
    });
  }

  @Get('products')
  @UseGuards(OptionalUserJwtGuard)
  @ApiOperation({ summary: '商品列表：分类 / 关键词 / 价格 / 标签 / 门店 / 排序 / 分页' })
  async products(
    @Query('categoryId') categoryId?: string,
    @Query('keyword') keyword?: string,
    @Query('priceMinCents') priceMinCents?: string,
    @Query('priceMaxCents') priceMaxCents?: string,
    @Query('tagId') tagId?: string,
    @Query('storeId') storeId?: string,
    @Query('ids') ids?: string,
    @Query('sort') sort = 'default',
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @OptionalCurrentUser() user?: MiniappUser,
  ) {
    // 微页面「手动选品」按 id 精确取数，顺序与传入一致
    if (ids !== undefined) {
      const list = ids
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 50);
      if (!list.length) return { total: 0, page: 1, pageSize: 0, items: [] };

      const rows = await this.prisma.product.findMany({
        where: { id: { in: list }, status: 'ON_SALE' },
        select: {
          id: true,
          title: true,
          subtitle: true,
          mainImageKey: true,
          priceMinCents: true,
          priceMaxCents: true,
          soldCount: true,
          status: true,
        },
      });
      const map = new Map(rows.map((row) => [row.id, row]));
      const items = list
        .map((id) => map.get(id))
        .filter((row): row is NonNullable<typeof row> => Boolean(row));
      return { total: items.length, page: 1, pageSize: items.length, items };
    }

    if (!PRODUCT_SORTS.includes(sort as ProductSort)) {
      throw new BadRequestException('排序方式不合法');
    }
    const minPrice = parseCents(priceMinCents, '最低价');
    const maxPrice = parseCents(priceMaxCents, '最高价');
    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
      throw new BadRequestException('最低价不能高于最高价');
    }

    const take = Math.min(Math.max(Number(pageSize) || 20, 1), 50);
    const currentPage = Math.max(Number(page) || 1, 1);
    const result = await searchProducts(this.prisma, {
      keyword,
      categoryId,
      priceMinCents: minPrice,
      priceMaxCents: maxPrice,
      tagId,
      storeId,
      sort: sort as ProductSort,
      page: currentPage,
      pageSize: take,
    });

    if (keyword?.trim()) {
      this.searchLogs.record({ keyword, resultCount: result.total, userId: user?.sub });
    }

    return {
      total: result.total,
      page: currentPage,
      pageSize: take,
      items: result.items,
    };
  }
}
