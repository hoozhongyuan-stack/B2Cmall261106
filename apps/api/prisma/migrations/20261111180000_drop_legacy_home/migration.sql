-- 首页统一由微页面渲染：移除旧版首页渲染开关
ALTER TABLE "ShopConfig" DROP COLUMN IF EXISTS "homeRenderer";
