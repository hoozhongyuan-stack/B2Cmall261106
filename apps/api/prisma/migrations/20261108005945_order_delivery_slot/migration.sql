-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliverySlot" TEXT;

-- CreateIndex
CREATE INDEX "Order_storeId_deliverySlot_idx" ON "Order"("storeId", "deliverySlot");
