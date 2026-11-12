-- 积分商城：商品渠道、兑换价、限兑、订单类型与积分字段
CREATE TYPE "ProductChannel" AS ENUM ('NORMAL', 'POINTS');

ALTER TABLE "Product"
    ADD COLUMN "channel" "ProductChannel" NOT NULL DEFAULT 'NORMAL',
    ADD COLUMN "pointsLimitPerUser" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Product_channel_status_idx" ON "Product"("channel", "status");

ALTER TABLE "Sku"
    ADD COLUMN "pointsCost" INTEGER,
    ADD COLUMN "pointsMoneyCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Order"
    ADD COLUMN "orderType" TEXT NOT NULL DEFAULT 'NORMAL',
    ADD COLUMN "pointsUsed" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "OrderItem" ADD COLUMN "pointsCost" INTEGER NOT NULL DEFAULT 0;

-- 每人限兑计数器：下单占用，取消 / 退款回补
CREATE TABLE "PointsMallQuota" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "usedQty" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PointsMallQuota_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PointsMallQuota_userId_productId_key" ON "PointsMallQuota"("userId", "productId");
CREATE INDEX "PointsMallQuota_productId_idx" ON "PointsMallQuota"("productId");

-- 角色默认权限：具备商品管理能力的角色补充积分商城权限
UPDATE "AdminRoleDef"
SET "permissions" = array_append(array_append("permissions", 'pointsmall.view'), 'pointsmall.manage'),
    "updatedAt" = NOW()
WHERE 'product.edit' = ANY("permissions")
  AND NOT ('pointsmall.manage' = ANY("permissions"));

UPDATE "AdminRoleDef"
SET "permissions" = array_append("permissions", 'pointsmall.view'),
    "updatedAt" = NOW()
WHERE 'product.view' = ANY("permissions")
  AND NOT ('pointsmall.view' = ANY("permissions"));
