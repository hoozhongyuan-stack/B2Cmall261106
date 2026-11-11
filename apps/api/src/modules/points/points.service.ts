import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService, type TxClient } from '../../prisma/prisma.module';
import { incrementCouponClaimed } from '../../prisma/queries';

export interface PointsConfigInput {
  yuanPerPoint?: number;
  signInPoints?: number;
  signInStreakDays?: number;
  signInStreakBonusType?: 'POINTS' | 'COUPON';
  signInStreakBonusPoints?: number;
  signInStreakCouponId?: string | null;
  sharePoints?: number;
  shareDailyLimit?: number;
}

const CONFIG_ID = 'singleton';
const DAY_MS = 24 * 60 * 60 * 1000;

/** 服务端日期（Asia/Shanghai），与弹窗广告口径一致 */
function serverDate(offsetDays = 0): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000 + offsetDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

@Injectable()
export class PointsService {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------- 后台配置 ---------------- */

  async config() {
    const row = await this.ensureConfig();
    return this.configView(row);
  }

  async updateConfig(input: PointsConfigInput) {
    const current = await this.ensureConfig();
    const next = {
      yuanPerPoint: this.int(input.yuanPerPoint, current.yuanPerPoint, 1, 1000, '消费积分比例'),
      signInPoints: this.int(input.signInPoints, current.signInPoints, 0, 1000, '签到积分'),
      signInStreakDays: this.int(
        input.signInStreakDays,
        current.signInStreakDays,
        0,
        365,
        '连续签到天数',
      ),
      signInStreakBonusType: input.signInStreakBonusType ?? current.signInStreakBonusType,
      signInStreakBonusPoints: this.int(
        input.signInStreakBonusPoints,
        current.signInStreakBonusPoints,
        0,
        10000,
        '连续签到奖励积分',
      ),
      signInStreakCouponId:
        input.signInStreakCouponId === undefined
          ? current.signInStreakCouponId
          : (input.signInStreakCouponId ?? '').trim() || null,
      sharePoints: this.int(input.sharePoints, current.sharePoints, 0, 1000, '分享积分'),
      shareDailyLimit: this.int(
        input.shareDailyLimit,
        current.shareDailyLimit,
        0,
        100,
        '分享每日上限',
      ),
    };

    if (next.signInStreakBonusType !== 'POINTS' && next.signInStreakBonusType !== 'COUPON') {
      throw new BadRequestException('连续奖励类型不合法');
    }
    if (next.signInStreakDays > 0 && next.signInStreakBonusType === 'COUPON') {
      if (!next.signInStreakCouponId) throw new BadRequestException('请选择连续签到奖励的优惠券');
      await this.assertCoupon(next.signInStreakCouponId);
    }

    const row = await this.prisma.pointsConfig.update({
      where: { id: CONFIG_ID },
      data: next,
    });
    return this.configView(row);
  }

  /* ---------------- 小程序 ---------------- */

  async overview(userId: string) {
    const config = await this.ensureConfig();
    const [user, last, todayShare] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
      this.prisma.pointsSignIn.findFirst({
        where: { userId },
        orderBy: { date: 'desc' },
      }),
      this.prisma.pointsShareDaily.findUnique({
        where: { userId_date: { userId, date: serverDate() } },
      }),
    ]);
    if (!user) throw new NotFoundException('用户不存在');

    const today = serverDate();
    const yesterday = serverDate(-1);
    const signedToday = last?.date === today;
    const streak = signedToday ? last.streak : last?.date === yesterday ? last.streak : 0;
    const nextStreak = signedToday ? streak : streak + 1;
    const streakDays = config.signInStreakDays;
    const remain = streakDays > 0 ? nextStreak % streakDays : 0;
    const nextBonusIn =
      streakDays > 0 ? (remain === 0 && nextStreak > 0 ? 0 : streakDays - remain) : null;

    const shareCount = todayShare?.count ?? 0;
    return {
      balance: user.points,
      config: this.configView(config),
      signIn: {
        enabled: config.signInPoints > 0,
        signedToday,
        streak,
        nextStreak,
        todayPoints: signedToday ? last?.points ?? 0 : config.signInPoints,
        bonusPoints: signedToday ? last?.bonusPoints ?? 0 : 0,
        nextBonusIn,
      },
      share: {
        enabled: config.sharePoints > 0 && config.shareDailyLimit > 0,
        points: config.sharePoints,
        limit: config.shareDailyLimit,
        todayCount: shareCount,
        remaining: Math.max(config.shareDailyLimit - shareCount, 0),
      },
    };
  }

  async signIn(userId: string) {
    const config = await this.ensureConfig();
    if (config.signInPoints <= 0) throw new BadRequestException('每日签到暂未开启');

    const today = serverDate();
    const yesterday = serverDate(-1);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.pointsSignIn.findUnique({
        where: { userId_date: { userId, date: today } },
      });
      if (existing) throw new ConflictException('今天已经签到过了');

      const last = await tx.pointsSignIn.findFirst({
        where: { userId, date: { lt: today } },
        orderBy: { date: 'desc' },
      });
      const streak = last?.date === yesterday ? last.streak + 1 : 1;
      let bonusPoints = 0;
      let bonusCouponClaimId: string | null = null;
      let bonusCouponName: string | null = null;

      if (config.signInStreakDays > 0 && streak % config.signInStreakDays === 0) {
        if (config.signInStreakBonusType === 'POINTS') {
          bonusPoints = config.signInStreakBonusPoints;
        } else if (config.signInStreakCouponId) {
          const coupon = await this.grantCoupon(tx, config.signInStreakCouponId, userId);
          if (coupon) {
            bonusCouponClaimId = coupon.claimId;
            bonusCouponName = coupon.name;
          }
        }
      }

      const total = config.signInPoints + bonusPoints;
      const user = await tx.user.update({
        where: { id: userId },
        data: { points: { increment: total } },
        select: { points: true },
      });

      const reason = bonusPoints
        ? `连续签到 ${streak} 天奖励`
        : bonusCouponName
          ? `连续签到 ${streak} 天送券`
          : '每日签到';
      await tx.pointsLedger.create({
        data: {
          userId,
          delta: total,
          source: 'SIGN_IN',
          reason,
          balanceAfter: user.points,
        },
      });
      await tx.pointsSignIn.create({
        data: {
          userId,
          date: today,
          points: total,
          streak,
          bonusPoints,
          bonusCouponClaimId,
        },
      });

      return {
        balance: user.points,
        points: total,
        basePoints: config.signInPoints,
        bonusPoints,
        streak,
        couponName: bonusCouponName,
      };
    });
  }

  async share(userId: string) {
    const config = await this.ensureConfig();
    if (config.sharePoints <= 0 || config.shareDailyLimit <= 0) {
      throw new BadRequestException('分享奖励暂未开启');
    }
    const today = serverDate();

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.pointsShareDaily.findUnique({
        where: { userId_date: { userId, date: today } },
      });
      if (current && current.count >= config.shareDailyLimit) {
        return {
          awarded: false,
          reason: '今日分享奖励已达上限',
          points: 0,
          todayCount: current.count,
          limit: config.shareDailyLimit,
        };
      }
      const count = (current?.count ?? 0) + 1;
      if (current) {
        await tx.pointsShareDaily.update({
          where: { userId_date: { userId, date: today } },
          data: { count },
        });
      } else {
        await tx.pointsShareDaily.create({ data: { userId, date: today, count } });
      }

      const user = await tx.user.update({
        where: { id: userId },
        data: { points: { increment: config.sharePoints } },
        select: { points: true },
      });
      await tx.pointsLedger.create({
        data: {
          userId,
          delta: config.sharePoints,
          source: 'SHARE',
          reason: '分享奖励',
          balanceAfter: user.points,
        },
      });

      return {
        awarded: true,
        points: config.sharePoints,
        balance: user.points,
        todayCount: count,
        limit: config.shareDailyLimit,
      };
    });
  }

  /* ---------------- 内部 ---------------- */

  private async ensureConfig() {
    return this.prisma.pointsConfig.upsert({
      where: { id: CONFIG_ID },
      update: {},
      create: { id: CONFIG_ID },
    });
  }

  private configView(row: {
    yuanPerPoint: number;
    signInPoints: number;
    signInStreakDays: number;
    signInStreakBonusType: string;
    signInStreakBonusPoints: number;
    signInStreakCouponId: string | null;
    sharePoints: number;
    shareDailyLimit: number;
  }) {
    return {
      yuanPerPoint: row.yuanPerPoint,
      signInPoints: row.signInPoints,
      signInStreakDays: row.signInStreakDays,
      signInStreakBonusType: row.signInStreakBonusType as 'POINTS' | 'COUPON',
      signInStreakBonusPoints: row.signInStreakBonusPoints,
      signInStreakCouponId: row.signInStreakCouponId,
      sharePoints: row.sharePoints,
      shareDailyLimit: row.shareDailyLimit,
    };
  }

  private int(
    value: number | undefined,
    fallback: number,
    min: number,
    max: number,
    label: string,
  ): number {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new BadRequestException(`${label}需为 ${min}-${max} 的整数`);
    }
    return value;
  }

  private async assertCoupon(couponId: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) throw new BadRequestException('优惠券不存在');
    if (!coupon.enabled) throw new BadRequestException('优惠券已停用');
    if (coupon.endAt.getTime() <= Date.now()) throw new BadRequestException('优惠券已过期');
  }

  /** 连续签到赠券：库存与每人限领校验后发券；失败返回 null（不影响签到积分） */
  private async grantCoupon(
    tx: TxClient,
    couponId: string,
    userId: string,
  ): Promise<{ claimId: string; name: string } | null> {
    const coupon = await tx.coupon.findUnique({ where: { id: couponId } });
    const now = new Date();
    if (!coupon || !coupon.enabled || now < coupon.startAt || now > coupon.endAt) return null;

    const updated = await incrementCouponClaimed(tx, coupon.id);
    if (updated !== 1) return null;
    const owned = await tx.couponClaim.count({ where: { couponId: coupon.id, userId } });
    if (owned >= coupon.perLimit) return null;

    const claim = await tx.couponClaim.create({
      data: { couponId: coupon.id, userId, status: 'UNUSED', expiresAt: coupon.endAt },
    });
    return { claimId: claim.id, name: coupon.name };
  }
}
