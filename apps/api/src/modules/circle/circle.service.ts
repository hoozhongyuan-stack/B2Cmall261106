import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.module';

export interface CategoryInput {
  name: string;
  iconKey?: string | null;
  sort?: number;
  enabled?: boolean;
}

export interface TopicInput {
  name: string;
  description?: string | null;
  coverKey?: string | null;
  categoryId?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  pinned?: boolean;
  enabled?: boolean;
  sort?: number;
}

export interface CircleSettingsInput {
  enabled?: boolean;
  auditMode?: string;
  dailyPostLimit?: number;
  dailyCommentLimit?: number;
  postPoints?: number;
  postPointsDailyLimit?: number;
}

const SETTINGS_DEFAULTS = {
  id: 'singleton',
  enabled: true,
  auditMode: 'HYBRID',
  dailyPostLimit: 5,
  dailyCommentLimit: 30,
  postPoints: 10,
  postPointsDailyLimit: 1,
};

@Injectable()
export class CircleService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories() {
    const items = await this.prisma.circleCategory.findMany({
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { posts: true } } },
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        iconKey: item.iconKey,
        sort: item.sort,
        enabled: item.enabled,
        postCount: item._count.posts,
        createdAt: item.createdAt,
      })),
    };
  }

  async createCategory(input: CategoryInput) {
    return this.prisma.circleCategory.create({
      data: {
        name: input.name.trim(),
        iconKey: input.iconKey ?? null,
        sort: input.sort ?? 0,
        enabled: input.enabled ?? true,
      },
    });
  }

  async updateCategory(id: string, input: CategoryInput) {
    await this.requireCategory(id);
    return this.prisma.circleCategory.update({
      where: { id },
      data: {
        name: input.name.trim(),
        ...(input.iconKey !== undefined ? { iconKey: input.iconKey || null } : {}),
        ...(input.sort !== undefined ? { sort: input.sort } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
    });
  }

  async removeCategory(id: string) {
    const category = await this.requireCategory(id);
    const posts = await this.prisma.circlePost.count({ where: { categoryId: id } });
    if (posts > 0) throw new BadRequestException('该分类下已有内容，只能停用');
    await this.prisma.circleCategory.delete({ where: { id: category.id } });
    return { ok: true };
  }

  async listTopics() {
    const items = await this.prisma.circleTopic.findMany({
      orderBy: [{ pinned: 'desc' }, { sort: 'asc' }, { createdAt: 'asc' }],
      include: { category: { select: { id: true, name: true } } },
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        coverKey: item.coverKey,
        categoryId: item.categoryId,
        categoryName: item.category?.name ?? null,
        startAt: item.startAt,
        endAt: item.endAt,
        pinned: item.pinned,
        enabled: item.enabled,
        sort: item.sort,
        postCount: item.postCount,
      })),
    };
  }

  async createTopic(input: TopicInput) {
    const window = this.topicWindow(input);
    if (input.categoryId) await this.requireCategory(input.categoryId);
    return this.prisma.circleTopic.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        coverKey: input.coverKey ?? null,
        categoryId: input.categoryId || null,
        ...window,
        pinned: input.pinned ?? false,
        enabled: input.enabled ?? true,
        sort: input.sort ?? 0,
      },
    });
  }

  async updateTopic(id: string, input: TopicInput) {
    await this.requireTopic(id);
    if (input.categoryId) await this.requireCategory(input.categoryId);
    const window = this.topicWindow(input);
    return this.prisma.circleTopic.update({
      where: { id },
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        ...(input.coverKey !== undefined ? { coverKey: input.coverKey || null } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId || null } : {}),
        ...window,
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.sort !== undefined ? { sort: input.sort } : {}),
      },
    });
  }

  async removeTopic(id: string) {
    const topic = await this.requireTopic(id);
    const posts = await this.prisma.circlePostTopic.count({ where: { topicId: id } });
    if (topic.postCount > 0 || posts > 0) {
      throw new BadRequestException('该话题下已有内容，只能停用');
    }
    await this.prisma.circleTopic.delete({ where: { id } });
    return { ok: true };
  }

  async getSettings() {
    const current = await this.prisma.circleSetting.findUnique({ where: { id: 'singleton' } });
    if (current) return current;
    return this.prisma.circleSetting.create({ data: SETTINGS_DEFAULTS });
  }

  async updateSettings(input: CircleSettingsInput) {
    if (input.auditMode && !['HYBRID', 'REVIEW'].includes(input.auditMode)) {
      throw new BadRequestException('审核模式不合法');
    }
    const current = await this.getSettings();
    return this.prisma.circleSetting.update({
      where: { id: current.id },
      data: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.auditMode !== undefined ? { auditMode: input.auditMode } : {}),
        ...(input.dailyPostLimit !== undefined ? { dailyPostLimit: input.dailyPostLimit } : {}),
        ...(input.dailyCommentLimit !== undefined
          ? { dailyCommentLimit: input.dailyCommentLimit }
          : {}),
        ...(input.postPoints !== undefined ? { postPoints: input.postPoints } : {}),
        ...(input.postPointsDailyLimit !== undefined
          ? { postPointsDailyLimit: input.postPointsDailyLimit }
          : {}),
      },
    });
  }

  private async requireCategory(id: string) {
    const category = await this.prisma.circleCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('分类不存在');
    return category;
  }

  private async requireTopic(id: string) {
    const topic = await this.prisma.circleTopic.findUnique({ where: { id } });
    if (!topic) throw new NotFoundException('话题不存在');
    return topic;
  }

  /** 统一处理话题起止时间，空字符串视为清空 */
  private topicWindow(input: TopicInput) {
    const startAt = input.startAt ? new Date(input.startAt) : null;
    const endAt = input.endAt ? new Date(input.endAt) : null;
    if (startAt && Number.isNaN(startAt.getTime())) throw new BadRequestException('开始时间不合法');
    if (endAt && Number.isNaN(endAt.getTime())) throw new BadRequestException('结束时间不合法');
    if (startAt && endAt && endAt <= startAt) {
      throw new BadRequestException('结束时间需晚于开始时间');
    }
    return {
      ...(input.startAt !== undefined ? { startAt } : {}),
      ...(input.endAt !== undefined ? { endAt } : {}),
    };
  }
}
