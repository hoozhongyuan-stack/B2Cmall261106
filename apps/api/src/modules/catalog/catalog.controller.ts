import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../../prisma/prisma.module';

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly prisma: PrismaService) {}

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

  @Get('products')
  @ApiOperation({ summary: '商品列表：分类 / 关键词 / 排序 / 分页' })
  async products(
    @Query('categoryId') categoryId?: string,
    @Query('keyword') keyword?: string,
    @Query('sort') sort: 'default' | 'sales' | 'price_asc' | 'price_desc' = 'default',
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const take = Math.min(Number(pageSize) || 20, 50);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    const where = {
      status: 'ON_SALE' as const,
      ...(categoryId ? { categoryId } : {}),
      ...(keyword ? { title: { contains: keyword, mode: 'insensitive' as const } } : {}),
    };
    const orderBy =
      sort === 'sales'
        ? { soldCount: 'desc' as const }
        : sort === 'price_asc'
          ? { priceMinCents: 'asc' as const }
          : sort === 'price_desc'
            ? { priceMinCents: 'desc' as const }
            : { sort: 'asc' as const };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({ where, orderBy, skip, take }),
      this.prisma.product.count({ where }),
    ]);

    return {
      total,
      page: Math.max(Number(page) || 1, 1),
      pageSize: take,
      items: items.map((p) => ({
        id: p.id,
        title: p.title,
        subtitle: p.subtitle,
        mainImageKey: p.mainImageKey,
        priceMinCents: p.priceMinCents,
        priceMaxCents: p.priceMaxCents,
        soldCount: p.soldCount,
        status: p.status,
      })),
    };
  }

  @Get('home')
  @ApiOperation({ summary: '首页聚合：分类 + 精选商品 + 包邮提示' })
  async home() {
    const [config, categories, picks] = await Promise.all([
      this.prisma.shopConfig.findFirst(),
      this.prisma.category.findMany({
        where: { parentId: null },
        orderBy: { sort: 'asc' },
        take: 6,
      }),
      this.prisma.product.findMany({
        where: { status: 'ON_SALE' },
        orderBy: { sort: 'asc' },
        take: 4,
      }),
    ]);

    return {
      freeThresholdCents: config?.freeThresholdCents ?? 9900,
      categories: categories.map((c, i) => ({ id: c.id, name: c.name, index: i + 1 })),
      picks: picks.map((p) => ({
        id: p.id,
        title: p.title,
        subtitle: p.subtitle,
        mainImageKey: p.mainImageKey,
        priceCents: p.priceMinCents,
      })),
    };
  }
}
