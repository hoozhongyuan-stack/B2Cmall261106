-- 迭代 C：付费会员卡、储值账户与流水、充值套餐

CREATE TABLE "MemberCardPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "discountRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "pointsRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "freeShipping" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "MemberCardPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemberCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "discountRate" DOUBLE PRECISION NOT NULL,
    "pointsRate" DOUBLE PRECISION NOT NULL,
    "freeShipping" BOOLEAN NOT NULL,
    "startAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    "expireAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemberCard_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MemberCard_userId_status_expireAt_idx" ON "MemberCard"("userId", "status", "expireAt");

CREATE TABLE "RechargePlan" (
    "id" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "bonusCents" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "RechargePlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoredValueAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "totalRechargedCents" INTEGER NOT NULL DEFAULT 0,
    "totalConsumedCents" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "StoredValueAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StoredValueAccount_userId_key" ON "StoredValueAccount"("userId");

CREATE TABLE "StoredValueLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deltaCents" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoredValueLedger_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StoredValueLedger_userId_createdAt_idx" ON "StoredValueLedger"("userId", "createdAt");

CREATE TABLE "RechargeOrder" (
    "id" TEXT NOT NULL,
    "rechargeNo" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "bonusCents" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "paidAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RechargeOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RechargeOrder_rechargeNo_key" ON "RechargeOrder"("rechargeNo");
CREATE INDEX "RechargeOrder_userId_createdAt_idx" ON "RechargeOrder"("userId", "createdAt");

ALTER TABLE "MemberCard" ADD CONSTRAINT "MemberCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoredValueAccount" ADD CONSTRAINT "StoredValueAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RechargeOrder" ADD CONSTRAINT "RechargeOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 默认会员卡方案（价格可按运营需要在后台调整）
INSERT INTO "MemberCardPlan" ("id", "name", "priceCents", "durationDays", "discountRate", "pointsRate", "freeShipping", "enabled", "sort", "createdAt", "updatedAt")
VALUES
  ('mcp_month', '山野月卡', 1990, 30, 0.95, 1.5, false, true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mcp_year', '山野年卡', 16800, 365, 0.90, 2, true, true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- 默认充值套餐
INSERT INTO "RechargePlan" ("id", "amountCents", "bonusCents", "enabled", "sort", "createdAt", "updatedAt")
VALUES
  ('rpp_100', 10000, 0, true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rpp_200', 20000, 2000, true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rpp_500', 50000, 8000, true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rpp_1000', 100000, 20000, true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
