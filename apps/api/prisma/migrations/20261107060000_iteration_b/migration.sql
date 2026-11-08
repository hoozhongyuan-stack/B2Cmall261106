-- 迭代 B：物流公司字典、首页运营位（轮播 / 金刚区 / 推荐位）

CREATE TABLE "ExpressCompany" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "ExpressCompany_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExpressCompany_code_key" ON "ExpressCompany"("code");

CREATE TABLE "HomeBanner" (
    "id" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "title" TEXT,
    "linkType" TEXT NOT NULL DEFAULT 'none',
    "linkValue" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "HomeBanner_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomeNav" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iconKey" TEXT,
    "linkType" TEXT NOT NULL DEFAULT 'category',
    "linkValue" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "HomeNav_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomeSection" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "productIds" JSONB NOT NULL DEFAULT '[]',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "HomeSection_pkey" PRIMARY KEY ("id")
);

-- 常用物流公司（可在后台增删改）
INSERT INTO "ExpressCompany" ("id", "code", "name", "sort", "enabled", "createdAt", "updatedAt")
VALUES
  ('exp_sf', 'SF', '顺丰速运', 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('exp_yto', 'YTO', '圆通速递', 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('exp_zto', 'ZTO', '中通快递', 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('exp_sto', 'STO', '申通快递', 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('exp_yd', 'YD', '韵达速递', 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('exp_jd', 'JD', '京东物流', 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('exp_ems', 'EMS', '邮政 EMS', 70, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('exp_jtsd', 'JTSD', '极兔速递', 80, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
