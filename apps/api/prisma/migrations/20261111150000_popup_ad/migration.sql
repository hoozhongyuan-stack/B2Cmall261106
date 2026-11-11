-- 首页弹窗广告
CREATE TABLE "PopupAd" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "alt" TEXT,
    "link" JSONB NOT NULL DEFAULT '{}',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "startAt" TIMESTAMPTZ(3),
    "endAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PopupAd_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PopupAd_enabled_priority_idx" ON "PopupAd"("enabled", "priority");
CREATE INDEX "PopupAd_deletedAt_idx" ON "PopupAd"("deletedAt");
