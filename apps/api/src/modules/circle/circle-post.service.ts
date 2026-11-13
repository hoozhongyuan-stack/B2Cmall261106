import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService, type TxClient } from '../../prisma/prisma.module';
import { AssetService } from '../assets/asset.service';
import { CircleContentSecurityService } from './circle-content-security.service';
import { CircleService } from './circle.service';

const MAX_IMAGES = 9;
const MAX_TOPICS = 3;
const MAX_PRODUCTS = 3;
const MAX_CONTENT = 1000;

export interface CreatePostInput {
  content?: string;
  categoryId: string;
  images?: string[];
  topicIds?: string[];
  productIds?: string[];
}

export type PostAuditAction = 'APPROVE' | 'REJECT' | 'HIDE';

const POST_STATUSES = ['PENDING', 'PUBLISHED', 'REJECTED', 'HIDDEN'] as const;

/** 服务端自然日（Asia/Shanghai）起点，用于每日发帖与积分上限 */
function dayStart(): Date {
  const offset = 8 * 60 * 60 * 1000;
  const shanghai = new Date(Date.now() + offset);
  return new Date(
    Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), shanghai.getUTCDate()) - offset,
  );
}

@Injectable()
export class CirclePostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetService,
    private readonly security: CircleContentSecurityService,
    private readonly circle: CircleService,
  ) {}

  /* ---------------- 会员端 ---------------- */

  /** 发布页可选的启用类目 */
  async categories() {
    const [settings, items] = await Promise.all([
      this.circle.getSettings(),
      this.prisma.circleCategory.findMany({
        where: { enabled: true },
        orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, iconKey: true },
      }),
    ]);
    return { enabled: settings.enabled, items };
  }

  /** 话题：启用且在活动时间内；可按类目筛选 */
  async topics(categoryId?: string) {
    const now = new Date();
    const items = await this.prisma.circleTopic.findMany({
      where: {
        enabled: true,
        ...(categoryId ? { categoryId } : {}),
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ endAt: null }, { endAt: { gte: now } }] },
        ],
      },
      orderBy: [{ pinned: 'desc' }, { sort: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        coverKey: true,
        description: true,
        categoryId: true,
        pinned: true,
        postCount: true,
      },
    });
    return { items };
  }

  /** 会员发帖：限频、校验、内容安全、按审核模式落状态，发布即发放积分 */
  async createPost(userId: string, input: CreatePostInput) {
    const settings = await this.circle.getSettings();
    if (!settings.enabled) throw new BadRequestException('圈子暂未开放');

    const content = (input.content ?? '').trim();
    if (content.length > MAX_CONTENT) {
      throw new BadRequestException(`正文不能超过 ${MAX_CONTENT} 个字符`);
    }
    const images = [...new Set((input.images ?? []).map((key) => key.trim()).filter(Boolean))];
    if (images.length > MAX_IMAGES) throw new BadRequestException(`最多上传 ${MAX_IMAGES} 张图片`);
    if (!content && !images.length) throw new BadRequestException('请填写正文或上传图片');
    await this.assets.assertReferences(images);

    const category = await this.prisma.circleCategory.findUnique({
      where: { id: input.categoryId },
    });
    if (!category) throw new BadRequestException('请选择内容类目');
    if (!category.enabled) throw new BadRequestException('该类目已停用');

    const topics = await this.resolveTopics(input.topicIds, category.id);
    const products = await this.resolveProducts(input.productIds);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, openid: true },
    });
    if (!user) throw new NotFoundException('用户不存在');

    if (settings.dailyPostLimit > 0) {
      const todayCount = await this.prisma.circlePost.count({
        where: { userId, createdAt: { gte: dayStart() } },
      });
      if (todayCount >= settings.dailyPostLimit) {
        throw new BadRequestException(`今日发帖已达上限（${settings.dailyPostLimit} 条）`);
      }
    }

    const check = await this.security.checkText(content, user.openid);
    const publish = settings.auditMode !== 'REVIEW' && !check.risky;

    const post = await this.prisma.$transaction(async (tx) => {
      const created = await tx.circlePost.create({
        data: {
          userId,
          categoryId: category.id,
          content,
          mediaJson: images.map((key) => ({ key })),
          status: publish ? 'PUBLISHED' : 'PENDING',
          auditNote: check.risky ? (check.note ?? '待人工审核') : null,
          publishedAt: publish ? new Date() : null,
        },
      });
      if (topics.length) {
        await tx.circlePostTopic.createMany({
          data: topics.map((topic, index) => ({
            postId: created.id,
            topicId: topic.id,
            sort: index,
          })),
        });
      }
      if (products.length) {
        await tx.circlePostProduct.createMany({
          data: products.map((product, index) => ({
            postId: created.id,
            productId: product.id,
            sort: index,
          })),
        });
      }

      let points = 0;
      if (publish) {
        await this.incrementTopicCounts(tx, topics.map((topic) => topic.id), 1);
        points = await this.rewardPost(tx, userId, created.id, settings);
      }
      return { id: created.id, status: created.status, points };
    });

    return {
      ...post,
      message:
        post.status === 'PUBLISHED'
          ? '发布成功'
          : '内容已提交，审核通过后将公开展示',
    };
  }

  /** 我的圈子：帖子列表（含审核状态与拒绝原因） */
  async listMyPosts(userId: string, status?: string) {
    const where = {
      userId,
      ...(status && POST_STATUSES.includes(status as (typeof POST_STATUSES)[number])
        ? { status: status as (typeof POST_STATUSES)[number] }
        : {}),
    };
    const items = await this.prisma.circlePost.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        category: { select: { id: true, name: true } },
        topics: { include: { topic: { select: { id: true, name: true } } } },
      },
    });
    return {
      items: items.map((post) => ({
        id: post.id,
        content: post.content,
        images: this.mediaKeys(post.mediaJson),
        status: post.status,
        auditNote: post.auditNote,
        category: post.category,
        topics: post.topics.map((item) => item.topic),
        likeCount: post.likeCount,
        commentCount: post.commentCount,
        favoriteCount: post.favoriteCount,
        viewCount: post.viewCount,
        createdAt: post.createdAt,
        publishedAt: post.publishedAt,
      })),
    };
  }

  /* ---------------- 后台审核 ---------------- */

  async listPosts(query: {
    status?: string;
    keyword?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(Number(query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100);
    const keyword = query.keyword?.trim();
    const status = POST_STATUSES.includes(query.status as (typeof POST_STATUSES)[number])
      ? (query.status as (typeof POST_STATUSES)[number])
      : undefined;

    const where = {
      ...(status ? { status } : {}),
      ...(keyword
        ? {
            OR: [
              { content: { contains: keyword, mode: 'insensitive' as const } },
              { user: { nickname: { contains: keyword, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const [rows, total, grouped] = await Promise.all([
      this.prisma.circlePost.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, nickname: true, avatarKey: true } },
          category: { select: { id: true, name: true } },
          topics: { include: { topic: { select: { id: true, name: true } } } },
          products: { select: { productId: true } },
        },
      }),
      this.prisma.circlePost.count({ where }),
      this.prisma.circlePost.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const counts: Record<string, number> = {
      ALL: 0,
      PENDING: 0,
      PUBLISHED: 0,
      REJECTED: 0,
      HIDDEN: 0,
    };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
      counts.ALL += row._count._all;
    }

    return {
      total,
      page,
      pageSize,
      counts,
      items: rows.map((post) => ({
        id: post.id,
        content: post.content,
        images: this.mediaKeys(post.mediaJson),
        status: post.status,
        auditNote: post.auditNote,
        pinned: post.pinned,
        featured: post.featured,
        likeCount: post.likeCount,
        commentCount: post.commentCount,
        favoriteCount: post.favoriteCount,
        viewCount: post.viewCount,
        productCount: post.products.length,
        rewardedAt: post.rewardedAt,
        createdAt: post.createdAt,
        publishedAt: post.publishedAt,
        auditedAt: post.auditedAt,
        author: post.user,
        category: post.category,
        topics: post.topics.map((item) => item.topic),
      })),
    };
  }

  /** 审核：通过 / 拒绝 / 隐藏；通过时补发积分（幂等） */
  async auditPost(
    id: string,
    action: PostAuditAction,
    note: string | undefined,
    actorId: string,
  ) {
    const post = await this.prisma.circlePost.findUnique({
      where: { id },
      include: { topics: { select: { topicId: true } } },
    });
    if (!post) throw new NotFoundException('内容不存在');

    const auditNote = (note ?? '').trim();
    if (action === 'REJECT' && !auditNote) throw new BadRequestException('请填写拒绝原因');
    if (auditNote.length > 200) throw new BadRequestException('审核说明不能超过 200 个字符');

    const settings = await this.circle.getSettings();
    const topicIds = post.topics.map((item) => item.topicId);
    const wasPublished = post.status === 'PUBLISHED';

    return this.prisma.$transaction(async (tx) => {
      let points = 0;

      if (action === 'APPROVE') {
        await tx.circlePost.update({
          where: { id },
          data: {
            status: 'PUBLISHED',
            auditNote: null,
            auditedBy: actorId,
            auditedAt: new Date(),
            publishedAt: post.publishedAt ?? new Date(),
          },
        });
        if (!wasPublished) await this.incrementTopicCounts(tx, topicIds, 1);
        points = await this.rewardPost(tx, post.userId, id, settings);
      } else if (action === 'REJECT') {
        await tx.circlePost.update({
          where: { id },
          data: {
            status: 'REJECTED',
            auditNote,
            auditedBy: actorId,
            auditedAt: new Date(),
          },
        });
        if (wasPublished) await this.incrementTopicCounts(tx, topicIds, -1);
      } else {
        await tx.circlePost.update({
          where: { id },
          data: {
            status: 'HIDDEN',
            auditNote: auditNote || null,
            auditedBy: actorId,
            auditedAt: new Date(),
          },
        });
        if (wasPublished) await this.incrementTopicCounts(tx, topicIds, -1);
      }

      return { ok: true, status: action === 'APPROVE' ? 'PUBLISHED' : action === 'REJECT' ? 'REJECTED' : 'HIDDEN', points };
    });
  }

  /* ---------------- 内部 ---------------- */

  private async resolveTopics(topicIds: string[] | undefined, categoryId: string) {
    const ids = [...new Set((topicIds ?? []).map((id) => id.trim()).filter(Boolean))];
    if (ids.length > MAX_TOPICS) throw new BadRequestException(`最多选择 ${MAX_TOPICS} 个话题`);
    if (!ids.length) return [];

    const now = new Date();
    const topics = await this.prisma.circleTopic.findMany({
      where: { id: { in: ids } },
      select: { id: true, enabled: true, categoryId: true, startAt: true, endAt: true },
    });
    if (topics.length !== ids.length) throw new BadRequestException('所选话题不存在');

    for (const topic of topics) {
      if (!topic.enabled) throw new BadRequestException('所选话题已停用');
      if (topic.startAt && topic.startAt > now) throw new BadRequestException('所选话题尚未开始');
      if (topic.endAt && topic.endAt < now) throw new BadRequestException('所选话题已结束');
      if (topic.categoryId && topic.categoryId !== categoryId) {
        throw new BadRequestException('话题与所选类目不一致');
      }
    }
    const map = new Map(topics.map((topic) => [topic.id, topic]));
    return ids.map((id) => map.get(id)!);
  }

  private async resolveProducts(productIds: string[] | undefined) {
    const ids = [...new Set((productIds ?? []).map((id) => id.trim()).filter(Boolean))];
    if (ids.length > MAX_PRODUCTS) throw new BadRequestException(`最多关联 ${MAX_PRODUCTS} 个商品`);
    if (!ids.length) return [];

    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, status: 'ON_SALE', channel: 'NORMAL' },
      select: { id: true },
    });
    if (products.length !== ids.length) throw new BadRequestException('所选商品不存在或已下架');
    const map = new Map(products.map((product) => [product.id, product]));
    return ids.map((id) => map.get(id)!);
  }

  private async incrementTopicCounts(tx: TxClient, topicIds: string[], delta: 1 | -1) {
    if (!topicIds.length) return;
    await tx.circleTopic.updateMany({
      where: { id: { in: topicIds }, ...(delta < 0 ? { postCount: { gt: 0 } } : {}) },
      data: { postCount: { increment: delta } },
    });
  }

  /**
   * 发帖积分：仅审核通过后发放，同一帖子只发一次；
   * 每日最多 postPointsDailyLimit 条计入（0 表示不限）。
   */
  private async rewardPost(
    tx: TxClient,
    userId: string,
    postId: string,
    settings: { postPoints: number; postPointsDailyLimit: number },
  ): Promise<number> {
    if (settings.postPoints <= 0) return 0;

    const marked = await tx.circlePost.updateMany({
      where: { id: postId, rewardedAt: null },
      data: { rewardedAt: new Date() },
    });
    if (!marked.count) return 0;

    if (settings.postPointsDailyLimit > 0) {
      const rewardedToday = await tx.circlePost.count({
        where: { userId, rewardedAt: { gte: dayStart() } },
      });
      if (rewardedToday > settings.postPointsDailyLimit) {
        await tx.circlePost.update({ where: { id: postId }, data: { rewardedAt: null } });
        return 0;
      }
    }

    const user = await tx.user.update({
      where: { id: userId },
      data: { points: { increment: settings.postPoints } },
      select: { points: true },
    });
    await tx.pointsLedger.create({
      data: {
        userId,
        delta: settings.postPoints,
        source: 'CIRCLE_POST',
        reason: '圈子发帖奖励',
        balanceAfter: user.points,
      },
    });
    return settings.postPoints;
  }

  private mediaKeys(mediaJson: unknown): string[] {
    if (!Array.isArray(mediaJson)) return [];
    return mediaJson
      .map((item) => (item as { key?: string } | null)?.key)
      .filter((key): key is string => Boolean(key));
  }
}
