import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService, type TxClient } from '../../prisma/prisma.module';
import { CircleContentSecurityService } from './circle-content-security.service';
import { CircleService } from './circle.service';

const MAX_CONTENT_EXCERPT = 120;
const MAX_COMMENTS = 20;
const MAX_REPLIES = 50;
const MAX_COMMENT_LENGTH = 500;
const REPORT_REASONS = ['广告引流', '违法违规', '色情低俗', '人身攻击', '虚假信息', '其他'];
const REPORT_TARGETS = ['POST', 'COMMENT', 'USER'];
const REPORT_AUTO_HIDE = 3;

export interface FeedQuery {
  tab?: string;
  categoryId?: string;
  topicId?: string;
  cursor?: string;
  pageSize?: number;
}

/** 服务端自然日（Asia/Shanghai）起点 */
function dayStart(): Date {
  const offset = 8 * 60 * 60 * 1000;
  const shanghai = new Date(Date.now() + offset);
  return new Date(
    Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), shanghai.getUTCDate()) - offset,
  );
}

@Injectable()
export class CircleInteractionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly security: CircleContentSecurityService,
    private readonly circle: CircleService,
  ) {}

  /* ---------------- 信息流 ---------------- */

  async feed(userId: string | undefined, query: FeedQuery) {
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 10, 1), 20);
    const tab = query.tab === 'latest' || query.tab === 'follow' ? query.tab : 'recommend';

    if (tab === 'follow') {
      if (!userId) return { items: [], nextCursor: null, needLogin: true };
      const follows = await this.prisma.circleFollow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      });
      if (!follows.length) return { items: [], nextCursor: null };
      const items = await this.fetchFeed(userId, {
        ...query,
        userIds: follows.map((row) => row.followingId),
        order: this.orderBy('latest'),
        pageSize,
      });
      return items;
    }

    return this.fetchFeed(userId, {
      ...query,
      order: this.orderBy(tab),
      pageSize,
    });
  }

  /** 帖子详情：仅已发布可被非作者查看；返回互动状态并累加浏览数 */
  async detail(userId: string | undefined, id: string) {
    const post = await this.prisma.circlePost.findUnique({
      where: { id },
      include: {
        ...this.postInclude(),
        products: {
          orderBy: { sort: 'asc' },
          include: {
            product: {
              select: {
                id: true,
                title: true,
                mainImageKey: true,
                priceMinCents: true,
                status: true,
              },
            },
          },
        },
      },
    });
    if (!post) throw new NotFoundException('内容不存在');
    if (post.status !== 'PUBLISHED' && post.userId !== userId) {
      throw new NotFoundException('内容不存在或已下架');
    }

    await this.prisma.circlePost
      .update({ where: { id }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);

    const [liked, favorited, following] = await this.flags(userId, [id], post.userId);
    return {
      ...this.postView(post, liked.has(id), favorited.has(id), following),
      status: post.status,
      viewerId: userId ?? null,
      isOwner: post.userId === userId,
    };
  }

  /** 作者删除内容：级联删除互动数据，并回退话题计数 */
  async removePost(userId: string, postId: string) {
    const post = await this.prisma.circlePost.findUnique({
      where: { id: postId },
      include: { topics: { select: { topicId: true } } },
    });
    if (!post) throw new NotFoundException('内容不存在');
    if (post.userId !== userId) throw new ForbiddenException('只能删除自己的内容');

    await this.prisma.$transaction(async (tx) => {
      if (post.status === 'PUBLISHED' && post.topics.length) {
        await tx.circleTopic.updateMany({
          where: { id: { in: post.topics.map((row) => row.topicId) }, postCount: { gt: 0 } },
          data: { postCount: { decrement: 1 } },
        });
      }
      await tx.circleNotification.deleteMany({ where: { postId } });
      await tx.circlePost.delete({ where: { id: postId } });
    });
    return { ok: true };
  }

  /* ---------------- 点赞 / 收藏 ---------------- */

  async like(userId: string, postId: string) {
    return this.prisma.$transaction(async (tx) => {
      const post = await tx.circlePost.findUnique({
        where: { id: postId },
        select: { id: true, userId: true, status: true },
      });
      if (!post || post.status !== 'PUBLISHED') throw new NotFoundException('内容不存在或已下架');

      const created = await tx.circleLike.createMany({
        data: [{ postId, userId }],
        skipDuplicates: true,
      });
      if (created.count) {
        await tx.circlePost.update({
          where: { id: postId },
          data: { likeCount: { increment: 1 } },
        });
        await this.notify(tx, {
          userId: post.userId,
          actorId: userId,
          type: 'LIKE',
          postId,
        });
      }
      const current = await tx.circlePost.findUnique({
        where: { id: postId },
        select: { likeCount: true },
      });
      return { liked: true, likeCount: current?.likeCount ?? 0 };
    });
  }

  async unlike(userId: string, postId: string) {
    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.circleLike.deleteMany({ where: { postId, userId } });
      if (removed.count) {
        await tx.circlePost.updateMany({
          where: { id: postId, likeCount: { gt: 0 } },
          data: { likeCount: { decrement: 1 } },
        });
      }
      const current = await tx.circlePost.findUnique({
        where: { id: postId },
        select: { likeCount: true },
      });
      return { liked: false, likeCount: current?.likeCount ?? 0 };
    });
  }

  async favorite(userId: string, postId: string) {
    return this.prisma.$transaction(async (tx) => {
      const post = await tx.circlePost.findUnique({
        where: { id: postId },
        select: { id: true, status: true },
      });
      if (!post || post.status !== 'PUBLISHED') throw new NotFoundException('内容不存在或已下架');

      const created = await tx.circleFavorite.createMany({
        data: [{ postId, userId }],
        skipDuplicates: true,
      });
      if (created.count) {
        await tx.circlePost.update({
          where: { id: postId },
          data: { favoriteCount: { increment: 1 } },
        });
      }
      const current = await tx.circlePost.findUnique({
        where: { id: postId },
        select: { favoriteCount: true },
      });
      return { favorited: true, favoriteCount: current?.favoriteCount ?? 0 };
    });
  }

  async unfavorite(userId: string, postId: string) {
    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.circleFavorite.deleteMany({ where: { postId, userId } });
      if (removed.count) {
        await tx.circlePost.updateMany({
          where: { id: postId, favoriteCount: { gt: 0 } },
          data: { favoriteCount: { decrement: 1 } },
        });
      }
      const current = await tx.circlePost.findUnique({
        where: { id: postId },
        select: { favoriteCount: true },
      });
      return { favorited: false, favoriteCount: current?.favoriteCount ?? 0 };
    });
  }

  /* ---------------- 评论 ---------------- */

  async comments(postId: string) {
    const post = await this.prisma.circlePost.findUnique({
      where: { id: postId },
      select: { id: true, commentCount: true },
    });
    if (!post) throw new NotFoundException('内容不存在');

    const roots = await this.prisma.circleComment.findMany({
      where: { postId, parentId: null, hidden: false },
      orderBy: { createdAt: 'asc' },
      take: MAX_COMMENTS,
      include: { user: { select: { id: true, nickname: true, avatarKey: true } } },
    });
    const replies = roots.length
      ? await this.prisma.circleComment.findMany({
          where: { postId, parentId: { in: roots.map((row) => row.id) }, hidden: false },
          orderBy: { createdAt: 'asc' },
          take: MAX_REPLIES,
          include: { user: { select: { id: true, nickname: true, avatarKey: true } } },
        })
      : [];

    return {
      total: post.commentCount,
      items: roots.map((root) => ({
        ...this.commentView(root),
        replies: replies.filter((reply) => reply.parentId === root.id).map(this.commentView),
      })),
    };
  }

  async createComment(
    userId: string,
    input: { postId: string; content: string; parentId?: string },
  ) {
    const content = (input.content ?? '').trim();
    if (!content) throw new BadRequestException('请填写评论内容');
    if (content.length > MAX_COMMENT_LENGTH) {
      throw new BadRequestException(`评论不能超过 ${MAX_COMMENT_LENGTH} 个字符`);
    }

    const settings = await this.circle.getSettings();
    if (settings.dailyCommentLimit > 0) {
      const todayCount = await this.prisma.circleComment.count({
        where: { userId, createdAt: { gte: dayStart() } },
      });
      if (todayCount >= settings.dailyCommentLimit) {
        throw new BadRequestException(`今日评论已达上限（${settings.dailyCommentLimit} 条）`);
      }
    }

    const post = await this.prisma.circlePost.findUnique({
      where: { id: input.postId },
      select: { id: true, userId: true, status: true },
    });
    if (!post) throw new NotFoundException('内容不存在');
    if (post.status !== 'PUBLISHED') throw new BadRequestException('该内容暂不可评论');

    let parent: { id: string; userId: string; parentId: string | null } | null = null;
    if (input.parentId) {
      parent = await this.prisma.circleComment.findFirst({
        where: { id: input.parentId, postId: post.id, hidden: false },
        select: { id: true, userId: true, parentId: true },
      });
      if (!parent) throw new BadRequestException('回复的评论不存在');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { openid: true },
    });
    if (!user) throw new NotFoundException('用户不存在');
    const check = await this.security.checkText(content, user.openid);
    if (check.risky) throw new BadRequestException('评论包含敏感内容，请修改后重试');

    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.circleComment.create({
        data: {
          postId: post.id,
          userId,
          parentId: parent?.id ?? null,
          content,
        },
        include: { user: { select: { id: true, nickname: true, avatarKey: true } } },
      });
      await tx.circlePost.update({
        where: { id: post.id },
        data: { commentCount: { increment: 1 } },
      });

      if (parent && parent.userId !== post.userId) {
        await this.notify(tx, {
          userId: parent.userId,
          actorId: userId,
          type: 'REPLY',
          postId: post.id,
          commentId: comment.id,
        });
      }
      await this.notify(tx, {
        userId: post.userId,
        actorId: userId,
        type: 'COMMENT',
        postId: post.id,
        commentId: comment.id,
      });

      return this.commentView(comment);
    });
  }

  /** 删除评论：作者或楼主可删；软删除并回退计数 */
  async removeComment(userId: string, commentId: string) {
    const comment = await this.prisma.circleComment.findUnique({
      where: { id: commentId },
      include: { post: { select: { userId: true } } },
    });
    if (!comment) throw new NotFoundException('评论不存在');
    if (comment.userId !== userId && comment.post.userId !== userId) {
      throw new ForbiddenException('只能删除自己的评论');
    }
    if (!comment.hidden) {
      await this.prisma.$transaction(async (tx) => {
        await tx.circleComment.update({ where: { id: commentId }, data: { hidden: true } });
        await tx.circlePost.updateMany({
          where: { id: comment.postId, commentCount: { gt: 0 } },
          data: { commentCount: { decrement: 1 } },
        });
      });
    }
    return { ok: true };
  }

  /* ---------------- 用户主页 / 关注 ---------------- */

  async userProfile(viewerId: string | undefined, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, nickname: true, avatarKey: true, createdAt: true },
    });
    if (!user) throw new NotFoundException('用户不存在');

    const [postCount, followerCount, followingCount, following] = await Promise.all([
      this.prisma.circlePost.count({ where: { userId, status: 'PUBLISHED' } }),
      this.prisma.circleFollow.count({ where: { followingId: userId } }),
      this.prisma.circleFollow.count({ where: { followerId: userId } }),
      viewerId
        ? this.prisma.circleFollow.findUnique({
            where: { followerId_followingId: { followerId: viewerId, followingId: userId } },
            select: { createdAt: true },
          })
        : Promise.resolve(null),
    ]);

    return {
      id: user.id,
      nickname: user.nickname,
      avatarKey: user.avatarKey,
      postCount,
      followerCount,
      followingCount,
      isSelf: viewerId === userId,
      isFollowing: Boolean(following),
    };
  }

  async follow(viewerId: string, userId: string) {
    if (viewerId === userId) throw new BadRequestException('不能关注自己');
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) throw new NotFoundException('用户不存在');

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.circleFollow.createMany({
        data: [{ followerId: viewerId, followingId: userId }],
        skipDuplicates: true,
      });
      if (created.count) {
        await this.notify(tx, {
          userId,
          actorId: viewerId,
          type: 'FOLLOW',
        });
      }
      return { following: true };
    });
  }

  async unfollow(viewerId: string, userId: string) {
    await this.prisma.circleFollow.deleteMany({
      where: { followerId: viewerId, followingId: userId },
    });
    return { following: false };
  }

  /** 用户的已发布内容 */
  async userPosts(userId: string) {
    const rows = await this.prisma.circlePost.findMany({
      where: { userId, status: 'PUBLISHED' },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: 30,
      include: this.postInclude(),
    });
    return { items: rows.map((post) => this.postView(post, false, false)) };
  }

  /* ---------------- 我的收藏 / 点赞 ---------------- */

  async myFavorites(userId: string) {
    return this.myJoinedPosts(userId, 'favorite');
  }

  async myLikes(userId: string) {
    return this.myJoinedPosts(userId, 'like');
  }

  private async myJoinedPosts(userId: string, kind: 'favorite' | 'like') {
    const rows =
      kind === 'favorite'
        ? await this.prisma.circleFavorite.findMany({
            where: { userId, post: { status: 'PUBLISHED' } },
            orderBy: { createdAt: 'desc' },
            take: 40,
            select: { postId: true },
          })
        : await this.prisma.circleLike.findMany({
            where: { userId, post: { status: 'PUBLISHED' } },
            orderBy: { createdAt: 'desc' },
            take: 40,
            select: { postId: true },
          });
    const ids = rows.map((row) => row.postId);
    if (!ids.length) return { items: [] };

    const posts = await this.prisma.circlePost.findMany({
      where: { id: { in: ids } },
      include: this.postInclude(),
    });
    const map = new Map(posts.map((post) => [post.id, post]));
    const [liked, favorited] = await this.flags(userId, ids);
    return {
      items: ids
        .map((id) => map.get(id))
        .filter((post): post is NonNullable<typeof post> => Boolean(post))
        .map((post) => this.postView(post, liked.has(post.id), favorited.has(post.id))),
    };
  }

  /* ---------------- 举报 ---------------- */

  async createReport(
    userId: string,
    input: { targetType: string; targetId: string; reason: string; detail?: string },
  ) {
    const targetType = (input.targetType ?? '').toUpperCase();
    if (!REPORT_TARGETS.includes(targetType)) throw new BadRequestException('举报对象不合法');
    if (!REPORT_REASONS.includes(input.reason)) throw new BadRequestException('请选择举报原因');
    const detail = (input.detail ?? '').trim();
    if (detail.length > 200) throw new BadRequestException('补充说明不能超过 200 个字符');

    await this.assertReportTarget(targetType, input.targetId);

    const duplicated = await this.prisma.circleReport.findFirst({
      where: { reporterId: userId, targetType, targetId: input.targetId },
      select: { id: true },
    });
    if (duplicated) throw new ConflictException('你已举报过该内容');

    return this.prisma.$transaction(async (tx) => {
      await tx.circleReport.create({
        data: {
          targetType,
          targetId: input.targetId,
          reporterId: userId,
          reason: input.reason,
          detail: detail || null,
        },
      });

      if (targetType === 'POST' || targetType === 'COMMENT') {
        const pending = await tx.circleReport.count({
          where: { targetType, targetId: input.targetId, status: 'PENDING' },
        });
        if (pending >= REPORT_AUTO_HIDE) {
          await this.autoHide(tx, targetType, input.targetId);
        }
      }
      return { ok: true };
    });
  }

  /* ---------------- 互动消息 ---------------- */

  async notifications(userId: string) {
    const [rows, unread] = await Promise.all([
      this.prisma.circleNotification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { actor: { select: { id: true, nickname: true, avatarKey: true } } },
      }),
      this.prisma.circleNotification.count({ where: { userId, read: false } }),
    ]);

    const postIds = [...new Set(rows.map((row) => row.postId).filter(Boolean))] as string[];
    const posts = postIds.length
      ? await this.prisma.circlePost.findMany({
          where: { id: { in: postIds } },
          select: { id: true, content: true, mediaJson: true },
        })
      : [];
    const postMap = new Map(posts.map((post) => [post.id, post]));

    const map: Record<string, string> = {
      LIKE: '赞了你的内容',
      COMMENT: '评论了你的内容',
      REPLY: '回复了你的评论',
      FOLLOW: '关注了你',
      SYSTEM: '系统通知',
    };

    return {
      unread,
      items: rows.map((row) => {
        const post = row.postId ? postMap.get(row.postId) : undefined;
        return {
          id: row.id,
          type: row.type,
          text: map[row.type] ?? '有新互动',
          read: row.read,
          createdAt: row.createdAt,
          actor: row.actor,
          post: post
            ? {
                id: post.id,
                excerpt: (post.content ?? '').slice(0, MAX_CONTENT_EXCERPT),
                image: this.mediaKeys(post.mediaJson)[0] ?? null,
              }
            : null,
        };
      }),
    };
  }

  async markNotificationsRead(userId: string, input: { ids?: string[]; all?: boolean }) {
    const ids = [...new Set((input.ids ?? []).filter(Boolean))];
    const result = await this.prisma.circleNotification.updateMany({
      where: {
        userId,
        read: false,
        ...(input.all ? {} : { id: { in: ids } }),
      },
      data: { read: true },
    });
    return { updated: result.count };
  }

  /* ---------------- 后台举报处理 ---------------- */

  async listReportsAdmin(query: { status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(Number(query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100);
    const status = ['PENDING', 'RESOLVED', 'REJECTED'].includes(query.status ?? '')
      ? (query.status as 'PENDING' | 'RESOLVED' | 'REJECTED')
      : undefined;

    const where = status ? { status } : {};
    const [rows, total, grouped] = await Promise.all([
      this.prisma.circleReport.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { reporter: { select: { id: true, nickname: true } } },
      }),
      this.prisma.circleReport.count({ where }),
      this.prisma.circleReport.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const counts: Record<string, number> = { ALL: 0, PENDING: 0, RESOLVED: 0, REJECTED: 0 };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
      counts.ALL += row._count._all;
    }

    // 目标内容预览：帖子与评论批量取，避免逐条查询
    const postIds = rows.filter((r) => r.targetType === 'POST').map((r) => r.targetId);
    const commentIds = rows.filter((r) => r.targetType === 'COMMENT').map((r) => r.targetId);
    const [posts, comments] = await Promise.all([
      postIds.length
        ? this.prisma.circlePost.findMany({
            where: { id: { in: postIds } },
            select: {
              id: true,
              content: true,
              status: true,
              mediaJson: true,
              user: { select: { id: true, nickname: true } },
            },
          })
        : Promise.resolve([]),
      commentIds.length
        ? this.prisma.circleComment.findMany({
            where: { id: { in: commentIds } },
            select: {
              id: true,
              content: true,
              hidden: true,
              user: { select: { id: true, nickname: true } },
            },
          })
        : Promise.resolve([]),
    ]);
    const postMap = new Map(posts.map((row) => [row.id, row]));
    const commentMap = new Map(comments.map((row) => [row.id, row]));

    return {
      total,
      page,
      pageSize,
      counts,
      items: rows.map((row) => {
        const post = postMap.get(row.targetId);
        const comment = commentMap.get(row.targetId);
        return {
          id: row.id,
          targetType: row.targetType,
          targetId: row.targetId,
          reason: row.reason,
          detail: row.detail,
          status: row.status,
          createdAt: row.createdAt,
          handledAt: row.handledAt,
          reporter: row.reporter,
          target:
            row.targetType === 'POST' && post
              ? {
                  content: post.content,
                  status: post.status,
                  author: post.user,
                  image: this.mediaKeys(post.mediaJson)[0] ?? null,
                }
              : row.targetType === 'COMMENT' && comment
                ? {
                    content: comment.content,
                    status: comment.hidden ? 'HIDDEN' : 'SHOWN',
                    author: comment.user,
                    image: null,
                  }
                : null,
        };
      }),
    };
  }

  /** 处理举报：下架目标内容或驳回举报，留痕 */
  async handleReport(reportId: string, action: 'HIDE' | 'DISMISS', actorId: string) {
    const report = await this.prisma.circleReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('举报记录不存在');
    if (report.status !== 'PENDING') throw new BadRequestException('该举报已处理');

    return this.prisma.$transaction(async (tx) => {
      if (action === 'HIDE') {
        await this.autoHide(tx, report.targetType, report.targetId);
      }
      await tx.circleReport.update({
        where: { id: reportId },
        data: {
          status: action === 'HIDE' ? 'RESOLVED' : 'REJECTED',
          handledBy: actorId,
          handledAt: new Date(),
        },
      });
      // 同一目标的其它待处理举报一并归档
      await tx.circleReport.updateMany({
        where: {
          targetType: report.targetType,
          targetId: report.targetId,
          status: 'PENDING',
          id: { not: reportId },
        },
        data: {
          status: action === 'HIDE' ? 'RESOLVED' : 'REJECTED',
          handledBy: actorId,
          handledAt: new Date(),
        },
      });
      return { ok: true };
    });
  }

  /* ---------------- 内部 ---------------- */

  private orderBy(tab: 'recommend' | 'latest') {
    return tab === 'recommend'
      ? ([
          { pinned: 'desc' },
          { featured: 'desc' },
          { likeCount: 'desc' },
          { publishedAt: 'desc' },
          { id: 'desc' },
        ] as const)
      : ([{ publishedAt: 'desc' }, { id: 'desc' }] as const);
  }

  private async fetchFeed(
    userId: string | undefined,
    query: FeedQuery & { order: ReturnType<CircleInteractionService['orderBy']>; userIds?: string[] },
  ) {
    const where = {
      status: 'PUBLISHED' as const,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.userIds ? { userId: { in: query.userIds } } : {}),
      ...(query.topicId ? { topics: { some: { topicId: query.topicId } } } : {}),
    };

    const rows = await this.prisma.circlePost.findMany({
      where,
      orderBy: [...query.order],
      take: query.pageSize,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: this.postInclude(),
    });

    const ids = rows.map((row) => row.id);
    const [liked, favorited] = await this.flags(userId, ids);
    return {
      items: rows.map((post) =>
        this.postView(post, liked.has(post.id), favorited.has(post.id)),
      ),
      nextCursor: rows.length === query.pageSize ? rows[rows.length - 1].id : null,
    };
  }

  private postInclude() {
    return {
      user: { select: { id: true, nickname: true, avatarKey: true } },
      category: { select: { id: true, name: true } },
      topics: { include: { topic: { select: { id: true, name: true } } } },
    } as const;
  }

  private postView(
    post: {
      id: string;
      content: string;
      mediaJson: unknown;
      pinned: boolean;
      featured: boolean;
      likeCount: number;
      commentCount: number;
      favoriteCount: number;
      viewCount: number;
      publishedAt: Date | null;
      createdAt: Date;
      user: { id: string; nickname: string | null; avatarKey: string | null };
      category: { id: string; name: string };
      topics: { topic: { id: string; name: string } }[];
      products?: {
        product: {
          id: string;
          title: string;
          mainImageKey: string | null;
          priceMinCents: number;
          status: string;
        };
      }[];
    },
    liked: boolean,
    favorited: boolean,
    followingAuthor = false,
  ) {
    return {
      id: post.id,
      content: post.content,
      images: this.mediaKeys(post.mediaJson),
      pinned: post.pinned,
      featured: post.featured,
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      favoriteCount: post.favoriteCount,
      viewCount: post.viewCount,
      createdAt: post.createdAt,
      publishedAt: post.publishedAt,
      author: post.user,
      category: post.category,
      topics: post.topics.map((item) => item.topic),
      products: (post.products ?? [])
        .map((item) => item.product)
        .filter((product) => product.status === 'ON_SALE'),
      liked,
      favorited,
      followingAuthor,
    };
  }

  private commentView(row: {
    id: string;
    parentId: string | null;
    content: string;
    createdAt: Date;
    userId: string;
    user: { id: string; nickname: string | null; avatarKey: string | null };
  }) {
    return {
      id: row.id,
      parentId: row.parentId,
      content: row.content,
      createdAt: row.createdAt,
      author: row.user,
    };
  }

  private async flags(userId: string | undefined, postIds: string[], authorId?: string) {
    if (!userId) return [new Set<string>(), new Set<string>(), false] as const;
    const [likes, favorites, following] = await Promise.all([
      postIds.length
        ? this.prisma.circleLike.findMany({
            where: { userId, postId: { in: postIds } },
            select: { postId: true },
          })
        : Promise.resolve([]),
      postIds.length
        ? this.prisma.circleFavorite.findMany({
            where: { userId, postId: { in: postIds } },
            select: { postId: true },
          })
        : Promise.resolve([]),
      authorId
        ? this.prisma.circleFollow.findUnique({
            where: { followerId_followingId: { followerId: userId, followingId: authorId } },
            select: { createdAt: true },
          })
        : Promise.resolve(null),
    ]);
    return [
      new Set(likes.map((row) => row.postId)),
      new Set(favorites.map((row) => row.postId)),
      Boolean(following),
    ] as const;
  }

  private async notify(
    tx: TxClient,
    input: {
      userId: string;
      actorId?: string;
      type: string;
      postId?: string;
      commentId?: string;
    },
  ) {
    if (input.actorId && input.actorId === input.userId) return;
    await tx.circleNotification.create({
      data: {
        userId: input.userId,
        actorId: input.actorId ?? null,
        type: input.type,
        postId: input.postId ?? null,
        commentId: input.commentId ?? null,
      },
    });
  }

  private async assertReportTarget(targetType: string, targetId: string) {
    if (targetType === 'POST') {
      const post = await this.prisma.circlePost.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      if (!post) throw new NotFoundException('举报的内容不存在');
      return;
    }
    if (targetType === 'COMMENT') {
      const comment = await this.prisma.circleComment.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      if (!comment) throw new NotFoundException('举报的评论不存在');
      return;
    }
    const user = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!user) throw new NotFoundException('举报的用户不存在');
  }

  /** 举报达到阈值或后台确认违规：隐藏帖子 / 评论 */
  private async autoHide(tx: TxClient, targetType: string, targetId: string) {
    if (targetType === 'POST') {
      const post = await tx.circlePost.findUnique({
        where: { id: targetId },
        include: { topics: { select: { topicId: true } } },
      });
      if (!post || post.status === 'HIDDEN') return;
      await tx.circlePost.update({
        where: { id: targetId },
        data: { status: 'HIDDEN', auditNote: '举报处理：内容违规', auditedAt: new Date() },
      });
      if (post.status === 'PUBLISHED' && post.topics.length) {
        await tx.circleTopic.updateMany({
          where: { id: { in: post.topics.map((row) => row.topicId) }, postCount: { gt: 0 } },
          data: { postCount: { decrement: 1 } },
        });
      }
      return;
    }
    if (targetType === 'COMMENT') {
      const comment = await tx.circleComment.findUnique({
        where: { id: targetId },
        select: { id: true, postId: true, hidden: true },
      });
      if (!comment || comment.hidden) return;
      await tx.circleComment.update({ where: { id: targetId }, data: { hidden: true } });
      await tx.circlePost.updateMany({
        where: { id: comment.postId, commentCount: { gt: 0 } },
        data: { commentCount: { decrement: 1 } },
      });
    }
  }

  private mediaKeys(mediaJson: unknown): string[] {
    if (!Array.isArray(mediaJson)) return [];
    return mediaJson
      .map((item) => (item as { key?: string } | null)?.key)
      .filter((key): key is string => Boolean(key));
  }
}
