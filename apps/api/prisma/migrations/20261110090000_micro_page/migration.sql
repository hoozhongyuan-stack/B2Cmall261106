-- 微页面装修 + 底部导航配置
CREATE TABLE "MicroPage" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "isHome" BOOLEAN NOT NULL DEFAULT false,
    "components" JSONB NOT NULL DEFAULT '[]',
    "publishedComponents" JSONB,
    "previousComponents" JSONB,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "publishedSettings" JSONB,
    "previousSettings" JSONB,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMPTZ(3),
    "publishedBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MicroPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MicroPage_code_key" ON "MicroPage"("code");
CREATE INDEX "MicroPage_status_isHome_idx" ON "MicroPage"("status", "isHome");
CREATE INDEX "MicroPage_deletedAt_idx" ON "MicroPage"("deletedAt");

CREATE TABLE "ShopTabbar" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "style" JSONB NOT NULL DEFAULT '{}',
    "items" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShopTabbar_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ShopConfig" ADD COLUMN "homeRenderer" TEXT NOT NULL DEFAULT 'legacy';
