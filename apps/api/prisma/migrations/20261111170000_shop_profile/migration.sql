-- 店铺基础信息：联系方式、经营主体与备案、官方商城地址
ALTER TABLE "ShopConfig"
  ADD COLUMN "serviceEmail" TEXT,
  ADD COLUMN "serviceWechat" TEXT,
  ADD COLUMN "serviceHours" TEXT,
  ADD COLUMN "companyAddress" TEXT,
  ADD COLUMN "companyName" TEXT,
  ADD COLUMN "creditCode" TEXT,
  ADD COLUMN "icpNumber" TEXT,
  ADD COLUMN "icpUrl" TEXT,
  ADD COLUMN "policeNumber" TEXT,
  ADD COLUMN "policeUrl" TEXT,
  ADD COLUMN "officialSiteUrl" TEXT;
