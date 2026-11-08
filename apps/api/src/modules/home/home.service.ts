import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.module';
import { AssetService } from '../assets/asset.service';

const LINK_TYPES = ['product', 'category', 'search', 'page', 'none'] as const;
type LinkType = (typeof LINK_TYPES)[number];

const MAX_BANNERS = 6;
const MAX_NAVS = 10;
const MAX_SECTIONS = 6;
const MAX_SECTION_PRODUCTS = 20;

export interface BannerInput {
  imageKey: string;
  title?: string | null;
  linkType: LinkType;
  linkValue?: string | null;
  sort: number;
  enabled: boolean;
}

export interface NavInput {
  name: string;
  iconKey?: string | null;
  linkType: LinkType;
  linkValue?: string | null;
  sort: number;
  enabled: boolean;
}

export interface SectionInput {
  title: string;
  productIds: string[];
  sort: number;
  enabled: boolean;
}

export interface HomeLayoutInput {
  banners: BannerInput[];
  navs: NavInput[];
  sections: SectionInput[];
}

@Injectable()
export class HomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetService,
  ) {}

  /** 小程序首页聚合：运营位优先，未配置时保留分类与精选兜底 */
  async aggregate() {
    const [config, categories, picks, banners, navs, sections, seckillRows] = await Promise.all([
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
      this.prisma.homeBanner.findMany({
        where: { enabled: true },
        orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
        take: MAX_BANNERS,
      }),
      this.prisma.homeNav.findMany({
        where: { enabled: true },
        orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
        take: MAX_NAVS,
      }),
      this.prisma.homeSection.findMany({
        where: { enabled: true },
        orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
        take: MAX_SECTIONS,
      }),
      this.prisma.seckillSku.findMany({
        where: {
          promotion: {
            type: 'SECKILL',
            enabled: true,
            startAt: { lte: new Date() },
            endAt: { gte: new Date() },
          },
        },
        include: { promotion: true, sku: { include: { product: true } } },
        orderBy: { sort: 'asc' },
        take: 6,
      }),
    ]);

    const allIds = [
      ...new Set(
        sections.flatMap((section) =>
          Array.isArray(section.productIds)
            ? (section.productIds as string[]).filter((id) => typeof id === 'string')
            : [],
        ),
      ),
    ];
    const products = allIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: allIds }, status: 'ON_SALE' },
        })
      : [];
    const productMap = new Map(products.map((product) => [product.id, product]));

    return {
      freeThresholdCents: config?.freeThresholdCents ?? 9900,
      banners: banners.map((banner) => ({
        id: banner.id,
        imageKey: banner.imageKey,
        title: banner.title,
        linkType: banner.linkType,
        linkValue: banner.linkValue,
      })),
      navs: navs.map((nav) => ({
        id: nav.id,
        name: nav.name,
        iconKey: nav.iconKey,
        linkType: nav.linkType,
        linkValue: nav.linkValue,
      })),
      sections: sections.map((section) => ({
        id: section.id,
        title: section.title,
        products: this.toProductList(section.productIds, productMap),
      })),
      seckills: seckillRows
        .filter((row) => row.sold < row.stock)
        .map((row) => ({
          promotionId: row.promotionId,
          promotionName: row.promotion.name,
          endAt: row.promotion.endAt,
          skuId: row.skuId,
          productId: row.sku.productId,
          title: row.sku.product.title,
          imageKey: row.sku.product.mainImageKey,
          originalPriceCents: row.sku.priceCents,
          seckillPriceCents: row.seckillPriceCents,
          stockLeft: row.stock - row.sold,
          limitPerUser: row.limitPerUser,
        })),
      categories: categories.map((category, index) => ({
        id: category.id,
        name: category.name,
        index: index + 1,
      })),
      picks: picks.map((product) => this.toProductCard(product)),
    };
  }

  async adminLayout() {
    const [banners, navs, sections] = await Promise.all([
      this.prisma.homeBanner.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.homeNav.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.homeSection.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    return { banners, navs, sections };
  }

  /** 全量保存运营位：一次事务替换，发布后首页即时生效 */
  async saveLayout(input: HomeLayoutInput) {
    this.assertLimits(input);
    await this.assertProducts(input.sections);

    const banners: Array<{
      imageKey: string;
      title: string | null;
      linkType: string;
      linkValue: string | null;
      sort: number;
      enabled: boolean;
    }> = [];
    for (const banner of input.banners) {
      await this.assets.assertReference(banner.imageKey);
      const link = await this.normalizeLink(banner.linkType, banner.linkValue);
      banners.push({
        imageKey: banner.imageKey,
        title: this.text(banner.title, 40) || null,
        linkType: link.linkType,
        linkValue: link.linkValue,
        sort: this.sort(banner.sort),
        enabled: Boolean(banner.enabled),
      });
    }

    const navs: Array<{
      name: string;
      iconKey: string | null;
      linkType: string;
      linkValue: string | null;
      sort: number;
      enabled: boolean;
    }> = [];
    for (const nav of input.navs) {
      if (nav.iconKey) await this.assets.assertReference(nav.iconKey);
      const link = await this.normalizeLink(nav.linkType, nav.linkValue);
      navs.push({
        name: this.requiredText(nav.name, 10, '入口名称'),
        iconKey: nav.iconKey || null,
        linkType: link.linkType,
        linkValue: link.linkValue,
        sort: this.sort(nav.sort),
        enabled: Boolean(nav.enabled),
      });
    }

    const sections = input.sections.map((section) => ({
      title: this.requiredText(section.title, 20, '推荐位标题'),
      productIds: section.productIds,
      sort: this.sort(section.sort),
      enabled: Boolean(section.enabled),
    }));

    await this.prisma.$transaction(async (tx) => {
      await tx.homeBanner.deleteMany();
      await tx.homeNav.deleteMany();
      await tx.homeSection.deleteMany();
      if (banners.length) await tx.homeBanner.createMany({ data: banners });
      if (navs.length) await tx.homeNav.createMany({ data: navs });
      for (const section of sections) {
        await tx.homeSection.create({
          data: {
            ...section,
            productIds: section.productIds as never,
          },
        });
      }
    });

    return this.adminLayout();
  }

  private assertLimits(input: HomeLayoutInput): void {
    if (input.banners.length > MAX_BANNERS) {
      throw new BadRequestException(`轮播最多 ${MAX_BANNERS} 张`);
    }
    if (input.navs.length > MAX_NAVS) {
      throw new BadRequestException(`金刚区最多 ${MAX_NAVS} 个入口`);
    }
    if (input.sections.length > MAX_SECTIONS) {
      throw new BadRequestException(`推荐位最多 ${MAX_SECTIONS} 个`);
    }
    for (const section of input.sections) {
      if (section.productIds.length > MAX_SECTION_PRODUCTS) {
        throw new BadRequestException(`单个推荐位最多 ${MAX_SECTION_PRODUCTS} 个商品`);
      }
      if (new Set(section.productIds).size !== section.productIds.length) {
        throw new BadRequestException('推荐位商品不能重复');
      }
    }
  }

  private async assertProducts(sections: SectionInput[]): Promise<void> {
    const ids = [...new Set(sections.flatMap((section) => section.productIds))];
    if (!ids.length) return;
    const count = await this.prisma.product.count({
      where: { id: { in: ids }, status: 'ON_SALE' },
    });
    if (count !== ids.length) {
      throw new BadRequestException('推荐位包含不存在或已下架的商品，请刷新后重新选择');
    }
  }

  private async normalizeLink(
    type: LinkType,
    value?: string | null,
  ): Promise<{ linkType: LinkType; linkValue: string | null }> {
    if (!LINK_TYPES.includes(type)) throw new BadRequestException('不支持的跳转类型');
    if (type === 'none') return { linkType: 'none', linkValue: null };

    const linkValue = (value ?? '').trim();
    if (!linkValue) throw new BadRequestException('请选择跳转目标');

    if (type === 'product') {
      const product = await this.prisma.product.findUnique({
        where: { id: linkValue },
        select: { id: true, status: true },
      });
      if (!product || product.status !== 'ON_SALE') {
        throw new BadRequestException('跳转商品不存在或已下架');
      }
    } else if (type === 'category') {
      const category = await this.prisma.category.findUnique({
        where: { id: linkValue },
        select: { id: true },
      });
      if (!category) throw new BadRequestException('跳转分类不存在');
    } else if (type === 'search') {
      if (linkValue.length > 50) throw new BadRequestException('搜索关键词过长');
    } else if (type === 'page') {
      if (!/^\/pages\/[A-Za-z0-9/_-]+/.test(linkValue)) {
        throw new BadRequestException('页面路径需以 /pages/ 开头');
      }
    }
    return { linkType: type, linkValue };
  }

  private toProductList(ids: unknown, map: Map<string, ProductRow>) {
    if (!Array.isArray(ids)) return [];
    return ids
      .map((id) => (typeof id === 'string' ? map.get(id) : undefined))
      .filter((product): product is ProductRow => Boolean(product))
      .map((product) => this.toProductCard(product));
  }

  private toProductCard(product: ProductRow) {
    return {
      id: product.id,
      title: product.title,
      subtitle: product.subtitle,
      mainImageKey: product.mainImageKey,
      priceCents: product.priceMinCents,
    };
  }

  private text(value: string | null | undefined, max: number): string {
    const text = (value ?? '').trim();
    if (text.length > max) throw new BadRequestException(`内容不能超过 ${max} 个字符`);
    return text;
  }

  private requiredText(value: string, max: number, label: string): string {
    const text = this.text(value, max);
    if (!text) throw new BadRequestException(`${label}不能为空`);
    return text;
  }

  private sort(value: number): number {
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException('排序必须为非负整数');
    }
    return value;
  }
}

interface ProductRow {
  id: string;
  title: string;
  subtitle: string | null;
  mainImageKey: string | null;
  priceMinCents: number;
}
