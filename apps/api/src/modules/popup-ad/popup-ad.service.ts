import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
// eslint-disable-next-line no-restricted-imports -- 需要 Prisma JSON 输入类型
import { Prisma } from '@prisma/client';
import { POPUP_AD_LIMITS, type MicroLink } from '@shanye/shared';

import { PrismaService } from '../../prisma/prisma.module';
import { AssetService } from '../assets/asset.service';
import { validateLink } from '../micro-page/micro-page.validate';

interface PopupAdInput {
  name: string;
  imageKey: string;
  alt?: string | null;
  link?: unknown;
  priority?: number;
  enabled?: boolean;
  startAt?: string | null;
  endAt?: string | null;
}

@Injectable()
export class PopupAdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetService,
  ) {}

  async list(query: { keyword?: string; enabled?: string; page?: number; pageSize?: number }) {
    const page = Math.max(Number(query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100);
    const keyword = query.keyword?.trim();
    const enabled =
      query.enabled === 'true' ? true : query.enabled === 'false' ? false : undefined;

    const where: Prisma.PopupAdWhereInput = {
      deletedAt: null,
      ...(enabled !== undefined ? { enabled } : {}),
      ...(keyword ? { name: { contains: keyword, mode: 'insensitive' } } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.popupAd.count({ where }),
      this.prisma.popupAd.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { total, page, pageSize, items: items.map((item) => this.view(item)) };
  }

  async detail(id: string) {
    return this.view(await this.find(id));
  }

  async create(input: PopupAdInput) {
    const count = await this.prisma.popupAd.count({ where: { deletedAt: null } });
    if (count >= POPUP_AD_LIMITS.maxAds) {
      throw new BadRequestException(`弹窗广告最多 ${POPUP_AD_LIMITS.maxAds} 条`);
    }
    const data = await this.normalize(input);
    if (data.enabled) await this.assertEnabledLimit();
    const row = await this.prisma.popupAd.create({ data });
    return this.view(row);
  }

  async update(id: string, input: PopupAdInput) {
    const current = await this.find(id);
    const data = await this.normalize(input);
    if (data.enabled && !current.enabled) await this.assertEnabledLimit(id);
    const row = await this.prisma.popupAd.update({ where: { id }, data });
    return this.view(row);
  }

  async setEnabled(id: string, enabled: boolean) {
    const current = await this.find(id);
    if (enabled && !current.enabled) await this.assertEnabledLimit(id);
    const row = await this.prisma.popupAd.update({ where: { id }, data: { enabled } });
    return this.view(row);
  }

  async remove(id: string) {
    await this.find(id);
    await this.prisma.popupAd.update({
      where: { id },
      data: { deletedAt: new Date(), enabled: false },
    });
    return { deleted: true };
  }

  /** 小程序：返回当前所有可展示广告，按优先级排序 */
  async active() {
    const now = new Date();
    const rows = await this.prisma.popupAd.findMany({
      where: {
        deletedAt: null,
        enabled: true,
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ endAt: null }, { endAt: { gte: now } }] },
        ],
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: POPUP_AD_LIMITS.maxActive,
    });

    return {
      ads: rows.map((row) => this.view(row)),
      serverDate: this.serverDate(),
    };
  }

  /* ---------------- 内部 ---------------- */

  private async find(id: string) {
    const row = await this.prisma.popupAd.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('弹窗广告不存在');
    return row;
  }

  private async normalize(input: PopupAdInput): Promise<Prisma.PopupAdUncheckedCreateInput> {
    const name = (input.name ?? '').trim();
    if (!name) throw new BadRequestException('名称不能为空');
    if (name.length > 20) throw new BadRequestException('名称不能超过 20 个字符');

    const imageKey = (input.imageKey ?? '').trim();
    if (!imageKey) throw new BadRequestException('请选择弹窗图片');
    await this.assets.assertReference(imageKey);

    const link = await validateLink(input.link, { prisma: this.prisma, assets: this.assets }, '弹窗跳转');

    const startAt = this.dateOf(input.startAt, '开始时间');
    const endAt = this.dateOf(input.endAt, '结束时间');
    if (startAt && endAt && startAt > endAt) {
      throw new BadRequestException('开始时间不能晚于结束时间');
    }

    const priority = Number(input.priority ?? 0);
    if (!Number.isInteger(priority)) throw new BadRequestException('优先级必须为整数');

    return {
      name,
      imageKey,
      alt: (input.alt ?? '').trim() || null,
      link: link as unknown as Prisma.InputJsonValue,
      priority,
      enabled: input.enabled !== false,
      startAt,
      endAt,
    };
  }

  private dateOf(value: string | null | undefined, label: string): Date | null {
    const text = (value ?? '').trim();
    if (!text) return null;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${label}格式不正确`);
    return date;
  }

  private async assertEnabledLimit(excludeId?: string) {
    const count = await this.prisma.popupAd.count({
      where: { deletedAt: null, enabled: true, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    if (count >= POPUP_AD_LIMITS.maxActive) {
      throw new BadRequestException(`最多同时启用 ${POPUP_AD_LIMITS.maxActive} 条弹窗广告`);
    }
  }

  private serverDate(): string {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private view(row: {
    id: string;
    name: string;
    imageKey: string;
    alt: string | null;
    link: unknown;
    priority: number;
    enabled: boolean;
    startAt: Date | null;
    endAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      name: row.name,
      imageKey: row.imageKey,
      alt: row.alt,
      link: (row.link ?? {}) as MicroLink,
      priority: row.priority,
      enabled: row.enabled,
      startAt: row.startAt,
      endAt: row.endAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
