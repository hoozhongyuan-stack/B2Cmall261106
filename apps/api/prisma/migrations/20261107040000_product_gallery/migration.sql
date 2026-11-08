-- 商品主图支持多张轮播；详情支持图片（按顺序上下排列）
ALTER TABLE "Product" ADD COLUMN     "mainImageKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "detailImageKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 历史单图回填为轮播首图
UPDATE "Product"
SET "mainImageKeys" = ARRAY["mainImageKey"]
WHERE "mainImageKey" IS NOT NULL AND "mainImageKey" <> '';
