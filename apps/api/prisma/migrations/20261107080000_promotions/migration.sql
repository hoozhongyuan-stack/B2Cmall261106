-- 迭代 D：满减活动、限时秒杀与订单金额字段

ALTER TABLE "Order" ADD COLUMN "fullReductionCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN "isSeckill" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OrderItem" ADD COLUMN "seckillId" TEXT;

CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "startAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    "endAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    "thresholdCents" INTEGER,
    "discountCents" INTEGER,
    "scopeType" TEXT NOT NULL DEFAULT 'ALL',
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Promotion_type_enabled_startAt_endAt_idx" ON "Promotion"("type", "enabled", "startAt", "endAt");

CREATE TABLE "PromotionScope" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    CONSTRAINT "PromotionScope_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PromotionScope_promotionId_targetType_targetId_key" ON "PromotionScope"("promotionId", "targetType", "targetId");
CREATE INDEX "PromotionScope_promotionId_idx" ON "PromotionScope"("promotionId");

CREATE TABLE "SeckillSku" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "seckillPriceCents" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "limitPerUser" INTEGER NOT NULL DEFAULT 1,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "SeckillSku_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SeckillSku_promotionId_skuId_key" ON "SeckillSku"("promotionId", "skuId");
CREATE INDEX "SeckillSku_skuId_idx" ON "SeckillSku"("skuId");

ALTER TABLE "PromotionScope" ADD CONSTRAINT "PromotionScope_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeckillSku" ADD CONSTRAINT "SeckillSku_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeckillSku" ADD CONSTRAINT "SeckillSku_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
