import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
// eslint-disable-next-line no-restricted-imports -- 需要 Prisma JSON 输入类型
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';

import {
  MICRO_INNER_PAGES,
  MICRO_LINK_LABELS,
  MICRO_PAGE_LIMITS,
  type MicroComponent,
  type MicroLink,
  type MicroPageSettings,
  type ShopTabbarConfig,
  type ShopTabbarItem,
} from '@shanye/shared';

import { tokens } from '@shanye/tokens';

import { PrismaService } from '../../prisma/prisma.module';
import { AssetService } from '../assets/asset.service';
import { validateComponents, validateLink, validateSettings } from './micro-page.validate';

const EMPTY_SETTINGS: MicroPageSettings = {
  shareTitle: '',
  shareDesc: '',
  shareImageKey: '',
  bgColor: '',
  navTitle: '',
  navColor: 'black',
  allowShare: true,
};

const DEFAULT_TABBAR: ShopTabbarConfig = {
  enabled: true,
  style: {},
  items: [
    { key: 'home', text: '首页', iconKey: null, activeIconKey: null, link: { type: 'page', value: '/pages/home/index' } },
    { key: 'category', text: '分类', iconKey: null, activeIconKey: null, link: { type: 'page', value: '/pages/category/index' } },
    { key: 'cart', text: '购物车', iconKey: null, activeIconKey: null, link: { type: 'page', value: '/pages/cart/index' } },
    { key: 'mine', text: '我的', iconKey: null, activeIconKey: null, link: { type: 'page', value: '/pages/mine/index' } },
  ],
};

interface AdminInfo {
  name?: string;
}

@Injectable()
export class MicroPageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetService,
  ) {}

  private ctx() {
    return { prisma: this.prisma, assets: this.assets };
  }

  /* ---------------- 后台：列表 / 详情 ---------------- */

  async listAdmin(query: {
    keyword?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(Number(query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100);
    const keyword = query.keyword?.trim();
    const status = query.status?.trim();

    const where: Prisma.MicroPageWhereInput = {
      deletedAt: null,
      ...(status === 'DRAFT' || status === 'PUBLISHED' ? { status } : {}),
      ...(keyword
        ? {
            OR: [
              { title: { contains: keyword, mode: 'insensitive' } },
              { code: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.microPage.count({ where }),
      this.prisma.microPage.findMany({
        where,
        orderBy: [{ isHome: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: rows.map((row) => this.view(row)),
    };
  }

  async detail(id: string) {
    const row = await this.findPage(id);
    return this.view(row, true);
  }

  /* ---------------- 后台：增删改 / 发布 ---------------- */

  async create(input: { title: string; code?: string; copyFromId?: string }, admin?: AdminInfo) {
    const title = this.titleOf(input.title);
    const count = await this.prisma.microPage.count({ where: { deletedAt: null } });
    if (count >= MICRO_PAGE_LIMITS.maxPages) {
      throw new BadRequestException(`微页面最多 ${MICRO_PAGE_LIMITS.maxPages} 个`);
    }

    let components: MicroComponent[] = [];
    let settings: MicroPageSettings = { ...EMPTY_SETTINGS };
    if (input.copyFromId) {
      const source = await this.findPage(input.copyFromId);
      components = this.componentsOf(source.components);
      settings = this.settingsOf(source.settings);
    }

    const code = input.code?.trim()
      ? this.codeOf(input.code)
      : await this.uniqueCode();
    const exists = await this.prisma.microPage.findUnique({ where: { code }, select: { id: true } });
    if (exists) throw new ConflictException('页面标识已被占用');

    const row = await this.prisma.microPage.create({
      data: {
        code,
        title,
        components: components as unknown as Prisma.InputJsonValue,
        settings: settings as unknown as Prisma.InputJsonValue,
        updatedBy: admin?.name ?? null,
      },
    });
    return this.view(row, true);
  }

  async saveDraft(
    id: string,
    input: {
      title?: string;
      components?: unknown;
      settings?: unknown;
      expectedUpdatedAt?: string;
    },
    admin?: AdminInfo,
  ) {
    const page = await this.findPage(id);
    this.assertVersion(page.updatedAt, input.expectedUpdatedAt);

    const data: Prisma.MicroPageUpdateInput = { updatedBy: admin?.name ?? null };
    if (input.title !== undefined) data.title = this.titleOf(input.title);
    if (input.components !== undefined) {
      // 草稿允许未填完的组件，发布时再严格校验
      const components = await validateComponents(input.components, this.ctx(), false);
      data.components = components as unknown as Prisma.InputJsonValue;
    }
    if (input.settings !== undefined) {
      const settings = await validateSettings(input.settings, this.ctx());
      data.settings = settings as unknown as Prisma.InputJsonValue;
    }

    const row = await this.prisma.microPage.update({ where: { id: page.id }, data });
    return this.view(row, true);
  }

  async publish(id: string, admin?: AdminInfo) {
    const page = await this.findPage(id);
    // 发布前全量重校验，避免草稿能存但线上组件失效
    const components = await validateComponents(page.components, this.ctx());
    const settings = await validateSettings(page.settings, this.ctx());

    const row = await this.prisma.microPage.update({
      where: { id: page.id },
      data: {
        status: 'PUBLISHED',
        components: components as unknown as Prisma.InputJsonValue,
        publishedComponents: components as unknown as Prisma.InputJsonValue,
        previousComponents: page.publishedComponents
          ? (page.publishedComponents as Prisma.InputJsonValue)
          : undefined,
        settings: settings as unknown as Prisma.InputJsonValue,
        publishedSettings: settings as unknown as Prisma.InputJsonValue,
        previousSettings: page.publishedSettings
          ? (page.publishedSettings as Prisma.InputJsonValue)
          : undefined,
        version: { increment: 1 },
        publishedAt: new Date(),
        publishedBy: admin?.name ?? null,
        updatedBy: admin?.name ?? null,
      },
    });
    return this.view(row, true);
  }

  async rollback(id: string, admin?: AdminInfo) {
    const page = await this.findPage(id);
    if (!page.previousComponents) throw new BadRequestException('没有可回滚的历史版本');

    const components = this.componentsOf(page.previousComponents);
    const settings = page.previousSettings
      ? this.settingsOf(page.previousSettings)
      : this.settingsOf(page.publishedSettings);

    const row = await this.prisma.microPage.update({
      where: { id: page.id },
      data: {
        components: components as unknown as Prisma.InputJsonValue,
        publishedComponents: components as unknown as Prisma.InputJsonValue,
        previousComponents: page.publishedComponents
          ? (page.publishedComponents as Prisma.InputJsonValue)
          : undefined,
        settings: settings as unknown as Prisma.InputJsonValue,
        publishedSettings: settings as unknown as Prisma.InputJsonValue,
        previousSettings: page.publishedSettings
          ? (page.publishedSettings as Prisma.InputJsonValue)
          : undefined,
        status: 'PUBLISHED',
        version: { increment: 1 },
        publishedAt: new Date(),
        publishedBy: admin?.name ?? null,
        updatedBy: admin?.name ?? null,
      },
    });
    return this.view(row, true);
  }

  async duplicate(id: string, admin?: AdminInfo) {
    const source = await this.findPage(id);
    return this.create(
      {
        title: `${source.title} 副本`.slice(0, 20),
        copyFromId: source.id,
      },
      admin,
    );
  }

  async setHome(id: string, admin?: AdminInfo) {
    const page = await this.findPage(id);
    if (page.status !== 'PUBLISHED' || !page.publishedComponents) {
      throw new BadRequestException('请先上线该页面，再设为首页');
    }

    await this.prisma.$transaction([
      this.prisma.microPage.updateMany({
        where: { isHome: true, NOT: { id: page.id } },
        data: { isHome: false },
      }),
      this.prisma.microPage.update({
        where: { id: page.id },
        data: { isHome: true, updatedBy: admin?.name ?? null },
      }),
      this.prisma.shopConfig.upsert({
        where: { id: 'singleton' },
        update: { homeRenderer: 'micro' },
        create: { id: 'singleton', homeRenderer: 'micro' },
      }),
    ]);
    return this.detail(page.id);
  }

  async removeHome() {
    await this.prisma.$transaction([
      this.prisma.microPage.updateMany({ where: { isHome: true }, data: { isHome: false } }),
      this.prisma.shopConfig.upsert({
        where: { id: 'singleton' },
        update: { homeRenderer: 'legacy' },
        create: { id: 'singleton', homeRenderer: 'legacy' },
      }),
    ]);
    return { homeRenderer: 'legacy' as const };
  }

  async remove(id: string, admin?: AdminInfo) {
    const page = await this.findPage(id);
    const references = await this.referencesOf(page);
    if (references.length) {
      throw new BadRequestException(`该页面正在被使用：${references.join('、')}，请先解除引用`);
    }

    await this.prisma.microPage.update({
      where: { id: page.id },
      data: { deletedAt: new Date(), isHome: false, updatedBy: admin?.name ?? null },
    });
    return { deleted: true };
  }

  /* ---------------- 后台：底部导航 ---------------- */

  async tabbar() {
    const row = await this.prisma.shopTabbar.findUnique({ where: { id: 'singleton' } });
    if (!row) return DEFAULT_TABBAR;
    return {
      enabled: row.enabled,
      style: (row.style ?? {}) as ShopTabbarConfig['style'],
      items: this.tabbarItemsOf(row.items),
    };
  }

  async saveTabbar(input: unknown) {
    const config = await this.validateTabbar(input);
    await this.prisma.shopTabbar.upsert({
      where: { id: 'singleton' },
      update: {
        enabled: config.enabled,
        style: config.style as unknown as Prisma.InputJsonValue,
        items: config.items as unknown as Prisma.InputJsonValue,
      },
      create: {
        id: 'singleton',
        enabled: config.enabled,
        style: config.style as unknown as Prisma.InputJsonValue,
        items: config.items as unknown as Prisma.InputJsonValue,
      },
    });
    return this.tabbar();
  }

  /* ---------------- 后台：链接选择器 ---------------- */

  async linkOptions(type: string, keyword?: string, limit = 20) {
    const term = (keyword ?? '').trim();
    const take = Math.min(Math.max(limit, 1), 50);
    const contains = term ? { contains: term, mode: 'insensitive' as const } : undefined;

    if (type === 'page' || type === 'none' || type === 'cart' || type === 'orders' || type === 'mine' || type === 'points') {
      return {
        items:
          type === 'page'
            ? MICRO_INNER_PAGES.map((item) => ({
                value: item.path,
                label: item.label,
                hint: item.hint ?? '',
              }))
            : [],
      };
    }

    if (type === 'micro') {
      const rows = await this.prisma.microPage.findMany({
        where: { deletedAt: null, ...(contains ? { title: contains } : {}) },
        select: { code: true, title: true, status: true },
        orderBy: { updatedAt: 'desc' },
        take,
      });
      return {
        items: rows.map((row) => ({
          value: row.code,
          label: row.title,
          hint: row.status === 'PUBLISHED' ? '' : '未上线',
        })),
      };
    }

    if (type === 'product') {
      const rows = await this.prisma.product.findMany({
        where: { status: 'ON_SALE', ...(contains ? { title: contains } : {}) },
        select: { id: true, title: true, priceMinCents: true },
        orderBy: { sort: 'asc' },
        take,
      });
      return {
        items: rows.map((row) => ({
          value: row.id,
          label: row.title,
          hint: `¥${(row.priceMinCents / 100).toFixed(2)}`,
        })),
      };
    }

    if (type === 'category') {
      const rows = await this.prisma.category.findMany({
        where: contains ? { name: contains } : {},
        select: { id: true, name: true },
        orderBy: { sort: 'asc' },
        take,
      });
      return { items: rows.map((row) => ({ value: row.id, label: row.name, hint: '' })) };
    }

    if (type === 'seckill') {
      const rows = await this.prisma.promotion.findMany({
        where: { type: 'SECKILL', ...(contains ? { name: contains } : {}) },
        select: { id: true, name: true, startAt: true, endAt: true, enabled: true },
        orderBy: { createdAt: 'desc' },
        take,
      });
      return {
        items: rows.map((row) => ({
          value: row.id,
          label: row.name,
          hint: row.enabled ? '' : '已停用',
        })),
      };
    }

    if (type === 'coupon') {
      const rows = await this.prisma.coupon.findMany({
        where: contains ? { name: contains } : {},
        select: { id: true, name: true, enabled: true },
        orderBy: { createdAt: 'desc' },
        take,
      });
      return {
        items: rows.map((row) => ({
          value: row.id,
          label: row.name,
          hint: row.enabled ? '' : '已停用',
        })),
      };
    }

    if (type === 'store') {
      const rows = await this.prisma.store.findMany({
        where: contains ? { name: contains } : {},
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
        take,
      });
      return { items: rows.map((row) => ({ value: row.id, label: row.name, hint: '' })) };
    }

    return { items: [] };
  }

  /* ---------------- 小程序：公开读取 ---------------- */

  async publicPage(code: string) {
    const page = await this.prisma.microPage.findFirst({
      where: { code, status: 'PUBLISHED', deletedAt: null },
    });
    if (!page || !page.publishedComponents) {
      throw new NotFoundException('页面不存在或已下线');
    }

    return {
      code: page.code,
      title: page.title,
      version: page.version,
      settings: { ...EMPTY_SETTINGS, ...this.settingsOf(page.publishedSettings) },
      components: this.componentsOf(page.publishedComponents),
      updatedAt: page.updatedAt,
    };
  }

  async shell() {
    const [config, home, tabbar] = await Promise.all([
      this.prisma.shopConfig.findFirst({ select: { homeRenderer: true } }),
      this.prisma.microPage.findFirst({
        where: { isHome: true, status: 'PUBLISHED', deletedAt: null },
        select: { code: true, updatedAt: true },
      }),
      this.tabbar(),
    ]);

    return {
      tabbar,
      homeCode: home?.code ?? null,
      homeRenderer: config?.homeRenderer === 'micro' ? ('micro' as const) : ('legacy' as const),
      updatedAt: home?.updatedAt ?? null,
    };
  }

  /* ---------------- 老首页迁移 ---------------- */

  async migrateLegacyHome() {
    const existing = await this.prisma.microPage.findFirst({
      where: { code: 'home', deletedAt: null },
    });
    if (existing) {
      return { created: false, page: this.view(existing) };
    }

    const [config, banners, navs, sections, categories, picks, seckillRows] = await Promise.all([
      this.prisma.shopConfig.findFirst(),
      this.prisma.homeBanner.findMany({
        where: { enabled: true },
        orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
        take: MICRO_PAGE_LIMITS.maxBannerItems,
      }),
      this.prisma.homeNav.findMany({
        where: { enabled: true },
        orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
        take: MICRO_PAGE_LIMITS.maxNavItems,
      }),
      this.prisma.homeSection.findMany({
        where: { enabled: true },
        orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
        take: 6,
      }),
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
      this.prisma.seckillSku.findMany({
        where: {
          promotion: {
            type: 'SECKILL',
            enabled: true,
            startAt: { lte: new Date() },
            endAt: { gte: new Date() },
          },
        },
        orderBy: { sort: 'asc' },
        take: 6,
      }),
    ]);

    const components: MicroComponent[] = [];
    const push = (
      type: MicroComponent['type'],
      props: Record<string, unknown>,
      style: MicroComponent['style'] = {},
    ) => {
      components.push({
        id: `cmp_${randomBytes(6).toString('hex')}`,
        type,
        visible: true,
        style: { margin: [0, 0, 0, 0], padding: [0, 0, 0, 0], bgColor: '', radius: 0, ...style },
        props,
      });
    };

    push(
      'text',
      {
        content: '山野好物 · 顺时而食',
        fontSize: 20,
        color: tokens.color.ink,
        weight: 'bold',
        align: 'center',
        lineHeight: 1.5,
        maxLines: 0,
        link: { type: 'none', value: null },
      },
      { margin: [16, 16, 8, 16] },
    );
    push(
      'search',
      {
        placeholder: '搜索山野好物',
        shape: 'capsule',
        bgColor: '',
        textColor: '',
        showHotwords: false,
        hotwords: [],
        link: { type: 'none', value: null },
      },
      { margin: [0, 16, 12, 16] },
    );
    push('notice', {
      text: `满 ¥${(((config?.freeThresholdCents ?? 9900) as number) / 100).toFixed(2)} 免运费，偏远地区除外`,
      tag: '包邮',
      scroll: false,
      speed: 80,
      textColor: '',
      bgColor: '',
      link: { type: 'none', value: null },
    });

    if (banners.length) {
      push(
        'banner',
        {
          items: banners.map((banner) => ({
            imageKey: banner.imageKey,
            title: banner.title ?? '',
            link: this.legacyLink(banner.linkType, banner.linkValue),
          })),
          ratio: '2:1',
          autoplay: true,
          interval: 4,
          indicator: 'dots',
        },
        { margin: [0, 12, 12, 12], radius: 8 },
      );
    }

    const navItems = navs.length
      ? navs.map((nav) => ({
          name: nav.name,
          iconKey: nav.iconKey ?? '',
          link: this.legacyLink(nav.linkType, nav.linkValue),
        }))
      : categories.map((category) => ({
          name: category.name.slice(0, 6),
          iconKey: '',
          link: { type: 'category' as const, value: category.id },
        }));
    if (navItems.length) {
      push('navGrid', {
        columns: navItems.length <= 4 ? 4 : 5,
        iconShape: 'circle',
        textColor: '',
        fontSize: 12,
        items: navItems,
      });
    }

    if (seckillRows.length) {
      push('goods', {
        source: 'seckill',
        productIds: [],
        categoryId: '',
        promotionId: seckillRows[0].promotionId,
        limit: 6,
        layout: 'scroll-x',
        show: { price: true, originPrice: true, sales: false, tag: true },
        buyButton: false,
        cardBg: '',
      });
    }

    if (sections.length) {
      for (const section of sections) {
        const productIds = Array.isArray(section.productIds)
          ? (section.productIds as string[]).filter((id) => typeof id === 'string')
          : [];
        if (!productIds.length) continue;
        push('goods', {
          source: 'manual',
          productIds,
          categoryId: '',
          promotionId: '',
          limit: Math.min(productIds.length, MICRO_PAGE_LIMITS.maxGoods),
          layout: 'grid-2',
          show: { price: true, originPrice: true, sales: false, tag: false },
          buyButton: false,
          cardBg: '',
        });
      }
    } else if (picks.length) {
      push('goods', {
        source: 'picks',
        productIds: [],
        categoryId: '',
        promotionId: '',
        limit: 4,
        layout: 'grid-2',
        show: { price: true, originPrice: true, sales: false, tag: false },
        buyButton: false,
        cardBg: '',
      });
    }

    const settings: MicroPageSettings = {
      ...EMPTY_SETTINGS,
      shareTitle: `${config?.shopName ?? '山野'} · 山野好物`,
      shareDesc: config?.intro ?? '',
      bgColor: tokens.color.canvas,
    };

    const normalized = await validateComponents(components, this.ctx());
    const row = await this.prisma.microPage.create({
      data: {
        code: 'home',
        title: '首页',
        status: 'PUBLISHED',
        isHome: false,
        components: normalized as unknown as Prisma.InputJsonValue,
        publishedComponents: normalized as unknown as Prisma.InputJsonValue,
        settings: settings as unknown as Prisma.InputJsonValue,
        publishedSettings: settings as unknown as Prisma.InputJsonValue,
        version: 1,
        publishedAt: new Date(),
        publishedBy: '系统迁移',
        updatedBy: '系统迁移',
      },
    });

    return { created: true, page: this.view(row) };
  }

  /* ---------------- 内部 ---------------- */

  private async findPage(id: string) {
    const page = await this.prisma.microPage.findFirst({ where: { id, deletedAt: null } });
    if (!page) throw new NotFoundException('微页面不存在');
    return page;
  }

  private assertVersion(actual: Date, expected?: string) {
    if (!expected) return;
    const expectedTime = new Date(expected).getTime();
    if (Number.isNaN(expectedTime)) return;
    if (actual.getTime() !== expectedTime) {
      throw new ConflictException('页面已被其他人修改，请刷新后重新编辑');
    }
  }

  private titleOf(value: string): string {
    const title = (value ?? '').trim();
    if (!title) throw new BadRequestException('页面名称不能为空');
    if (title.length > 20) throw new BadRequestException('页面名称不能超过 20 个字符');
    return title;
  }

  private codeOf(value: string): string {
    const code = value.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,32}$/.test(code)) {
      throw new BadRequestException('页面标识只能包含小写字母、数字与短横线，2~32 位');
    }
    return code;
  }

  private async uniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = `mp-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
      const exists = await this.prisma.microPage.findUnique({ where: { code }, select: { id: true } });
      if (!exists) return code;
    }
    throw new ConflictException('生成页面标识失败，请重试');
  }

  private componentsOf(value: unknown): MicroComponent[] {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is MicroComponent =>
        Boolean(item) && typeof item === 'object' && typeof (item as MicroComponent).type === 'string',
    );
  }

  private settingsOf(value: unknown): MicroPageSettings {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...EMPTY_SETTINGS };
    return { ...EMPTY_SETTINGS, ...(value as MicroPageSettings) };
  }

  private tabbarItemsOf(value: unknown): ShopTabbarItem[] {
    if (!Array.isArray(value)) return DEFAULT_TABBAR.items;
    const items = value.filter(
      (item): item is ShopTabbarItem =>
        Boolean(item) && typeof item === 'object' && typeof (item as ShopTabbarItem).text === 'string',
    );
    return items.length ? items : DEFAULT_TABBAR.items;
  }

  private view(
    row: {
      id: string;
      code: string;
      title: string;
      status: string;
      isHome: boolean;
      components: unknown;
      publishedComponents: unknown;
      settings: unknown;
      publishedSettings: unknown;
      version: number;
      publishedAt: Date | null;
      updatedAt: Date;
      createdAt: Date;
    },
    withDraft = false,
  ) {
    const base = {
      id: row.id,
      code: row.code,
      title: row.title,
      status: row.status,
      isHome: row.isHome,
      version: row.version,
      publishedAt: row.publishedAt,
      publishedComponentCount: this.componentsOf(row.publishedComponents).length,
      componentCount: this.componentsOf(row.components).length,
      published: Boolean(row.publishedComponents),
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    };
    if (!withDraft) return base;
    return {
      ...base,
      components: this.componentsOf(row.components),
      settings: this.settingsOf(row.settings),
      publishedComponents: this.componentsOf(row.publishedComponents),
      publishedSettings: row.publishedSettings ? this.settingsOf(row.publishedSettings) : null,
    };
  }

  private async referencesOf(page: {
    id: string;
    code: string;
    isHome: boolean;
  }): Promise<string[]> {
    const references: string[] = [];
    if (page.isHome) references.push('当前首页');

    const tabbar = await this.tabbar();
    for (const item of tabbar.items) {
      if (item.link?.type === 'micro' && item.link.value === page.code) {
        references.push(`底部导航「${item.text}」`);
      }
    }

    const pages = await this.prisma.microPage.findMany({
      where: { deletedAt: null, NOT: { id: page.id } },
      select: { title: true, components: true, publishedComponents: true },
    });
    for (const item of pages) {
      const raw = JSON.stringify([item.components, item.publishedComponents]);
      if (raw.includes(`"micro","value":"${page.code}"`)) {
        references.push(`微页面「${item.title}」`);
      }
    }
    return references;
  }

  private async validateTabbar(input: unknown): Promise<ShopTabbarConfig> {
    const raw = (input ?? {}) as Record<string, unknown>;
    const enabled = raw.enabled !== false;
    const styleInput = (raw.style ?? {}) as Record<string, unknown>;
    const style: ShopTabbarConfig['style'] = {
      background: this.tabbarColor(styleInput.background, ''),
      color: this.tabbarColor(styleInput.color, ''),
      selectedColor: this.tabbarColor(styleInput.selectedColor, ''),
      borderTop: styleInput.borderTop !== false,
    };

    const rawItems = Array.isArray(raw.items) ? raw.items : [];
    if (rawItems.length < MICRO_PAGE_LIMITS.minTabbarItems || rawItems.length > MICRO_PAGE_LIMITS.maxTabbarItems) {
      throw new BadRequestException(
        `底部导航需要 ${MICRO_PAGE_LIMITS.minTabbarItems}~${MICRO_PAGE_LIMITS.maxTabbarItems} 个入口`,
      );
    }

    const keys = new Set<string>();
    const items: ShopTabbarItem[] = [];
    for (const [index, entry] of rawItems.entries()) {
      if (!entry || typeof entry !== 'object') throw new BadRequestException(`第 ${index + 1} 个入口格式不正确`);
      const item = entry as Record<string, unknown>;
      const text = String(item.text ?? '').trim();
      if (!text) throw new BadRequestException(`第 ${index + 1} 个入口名称不能为空`);
      if (text.length > 5) throw new BadRequestException(`第 ${index + 1} 个入口名称不能超过 5 个字符`);

      let key = String(item.key ?? '').trim() || `tab-${index + 1}`;
      if (keys.has(key)) key = `${key}-${index + 1}`;
      keys.add(key);

      const iconKey = String(item.iconKey ?? '').trim();
      if (iconKey) await this.assets.assertReference(iconKey);
      const activeIconKey = String(item.activeIconKey ?? '').trim();
      if (activeIconKey) await this.assets.assertReference(activeIconKey);

      const link = await validateLink(item.link, this.ctx(), `第 ${index + 1} 个入口链接`);
      if (link.type === 'none') throw new BadRequestException(`第 ${index + 1} 个入口需要选择跳转目标`);

      items.push({
        key,
        text,
        iconKey: iconKey || null,
        activeIconKey: activeIconKey || null,
        link,
      });
    }

    const home = await this.prisma.microPage.findFirst({
      where: { isHome: true, deletedAt: null },
      select: { code: true },
    });
    const hasHome = items.some(
      (item) =>
        (item.link.type === 'page' && item.link.value === '/pages/home/index') ||
        (item.link.type === 'micro' && home?.code === item.link.value),
    );
    if (!hasHome) throw new BadRequestException('底部导航必须有一个入口指向首页');

    return { enabled, style, items };
  }

  private tabbarColor(value: unknown, fallback: string): string {
    const color = typeof value === 'string' ? value.trim() : '';
    if (!color) return fallback;
    if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
      throw new BadRequestException(`颜色 ${color} 格式不正确`);
    }
    return color;
  }

  private legacyLink(linkType: string | null, linkValue: string | null): MicroLink {
    const value = (linkValue ?? '').trim();
    if (!value || linkType === 'none') return { type: 'none', value: null };
    if (linkType === 'product' || linkType === 'category' || linkType === 'search') {
      return { type: linkType, value };
    }
    if (linkType === 'page') {
      return { type: 'page', value };
    }
    return { type: 'none', value: null };
  }

  /** 供控制器展示链接类型文案（避免前端重复维护） */
  linkLabel(type: string): string {
    return MICRO_LINK_LABELS[type as keyof typeof MICRO_LINK_LABELS] ?? type;
  }
}
