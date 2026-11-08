-- 修正历史迁移的时间列类型：与 schema 的 @db.Timestamptz(3) 对齐
ALTER TABLE "IntegrationConfig" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "MiniappRelease" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "MiniappRelease" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3);

-- AlterEnum
ALTER TYPE "AdminRole" ADD VALUE 'STORE';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "fulfillmentType" TEXT NOT NULL DEFAULT 'EXPRESS',
ADD COLUMN     "pickupAt" TIMESTAMPTZ(3),
ADD COLUMN     "pickupCode" TEXT,
ADD COLUMN     "pickupCodeExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "storeId" TEXT;

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "region" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "businessHours" JSONB NOT NULL DEFAULT '{}',
    "pickupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
    "freeDeliveryThresholdCents" INTEGER NOT NULL DEFAULT 0,
    "deliverySlots" JSONB NOT NULL DEFAULT '[]',
    "deliveryCutoff" TEXT,
    "maxOrdersPerSlot" INTEGER NOT NULL DEFAULT 0,
    "pickupCompleteDays" INTEGER NOT NULL DEFAULT 7,
    "notice" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminStore" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "AdminStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSku" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "safetyStock" INTEGER NOT NULL DEFAULT 0,
    "status" "ProductStatus" NOT NULL DEFAULT 'ON_SALE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StoreSku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreDeliveryRegion" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "regionName" TEXT NOT NULL,

    CONSTRAINT "StoreDeliveryRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreStockLog" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "beforeStock" INTEGER NOT NULL,
    "afterStock" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "orderId" TEXT,
    "operatorId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreStockLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Store_code_key" ON "Store"("code");

-- CreateIndex
CREATE INDEX "Store_status_sort_idx" ON "Store"("status", "sort");

-- CreateIndex
CREATE INDEX "AdminStore_storeId_idx" ON "AdminStore"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminStore_adminUserId_storeId_key" ON "AdminStore"("adminUserId", "storeId");

-- CreateIndex
CREATE INDEX "StoreSku_skuId_idx" ON "StoreSku"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreSku_storeId_skuId_key" ON "StoreSku"("storeId", "skuId");

-- CreateIndex
CREATE INDEX "StoreDeliveryRegion_regionName_idx" ON "StoreDeliveryRegion"("regionName");

-- CreateIndex
CREATE UNIQUE INDEX "StoreDeliveryRegion_storeId_regionName_key" ON "StoreDeliveryRegion"("storeId", "regionName");

-- CreateIndex
CREATE INDEX "StoreStockLog_storeId_createdAt_idx" ON "StoreStockLog"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "StoreStockLog_skuId_idx" ON "StoreStockLog"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_pickupCode_key" ON "Order"("pickupCode");

-- CreateIndex
CREATE INDEX "Order_storeId_createdAt_idx" ON "Order"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_fulfillmentType_status_idx" ON "Order"("fulfillmentType", "status");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminStore" ADD CONSTRAINT "AdminStore_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminStore" ADD CONSTRAINT "AdminStore_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSku" ADD CONSTRAINT "StoreSku_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSku" ADD CONSTRAINT "StoreSku_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreDeliveryRegion" ADD CONSTRAINT "StoreDeliveryRegion_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreStockLog" ADD CONSTRAINT "StoreStockLog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

