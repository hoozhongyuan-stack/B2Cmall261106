-- 门店关联会员：门店负责人使用小程序「门店中心」，PC 不再支持 STORE 账号登录

ALTER TABLE "Store" ADD COLUMN "managerUserId" TEXT;
CREATE UNIQUE INDEX "Store_managerUserId_key" ON "Store"("managerUserId");
ALTER TABLE "Store" ADD CONSTRAINT "Store_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
