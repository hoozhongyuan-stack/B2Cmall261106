-- 临时打烊：截止时间之前门店不接受新订单
ALTER TABLE "Store" ADD COLUMN "temporarilyClosedUntil" TIMESTAMPTZ(3);
ALTER TABLE "Store" ADD COLUMN "temporaryClosureNote" TEXT;
