-- 圈子发帖积分发放标记，避免重复奖励
ALTER TABLE "CirclePost" ADD COLUMN "rewardedAt" TIMESTAMPTZ(3);
