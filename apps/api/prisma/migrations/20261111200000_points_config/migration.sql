-- 门店 Logo
ALTER TABLE "Store" ADD COLUMN "logoKey" TEXT;

-- 积分规则与签到 / 分享计数
CREATE TABLE "PointsConfig" (
    "id" TEXT NOT NULL,
    "yuanPerPoint" INTEGER NOT NULL DEFAULT 1,
    "signInPoints" INTEGER NOT NULL DEFAULT 0,
    "signInStreakDays" INTEGER NOT NULL DEFAULT 0,
    "signInStreakBonusType" TEXT NOT NULL DEFAULT 'POINTS',
    "signInStreakBonusPoints" INTEGER NOT NULL DEFAULT 0,
    "signInStreakCouponId" TEXT,
    "sharePoints" INTEGER NOT NULL DEFAULT 0,
    "shareDailyLimit" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PointsConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PointsSignIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 1,
    "bonusPoints" INTEGER NOT NULL DEFAULT 0,
    "bonusCouponClaimId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsSignIn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PointsSignIn_userId_date_key" ON "PointsSignIn"("userId", "date");
CREATE INDEX "PointsSignIn_userId_date_idx" ON "PointsSignIn"("userId", "date");

CREATE TABLE "PointsShareDaily" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PointsShareDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PointsShareDaily_userId_date_key" ON "PointsShareDaily"("userId", "date");

ALTER TABLE "PointsSignIn" ADD CONSTRAINT "PointsSignIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointsShareDaily" ADD CONSTRAINT "PointsShareDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
