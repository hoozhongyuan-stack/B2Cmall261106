-- 角色权限体系：角色表 + 账号类型 / 超管标记 / 角色关联
CREATE TYPE "AdminUserKind" AS ENUM ('PC', 'STORE');

CREATE TABLE "AdminRoleDef" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AdminRoleDef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminRoleDef_name_key" ON "AdminRoleDef"("name");

ALTER TABLE "AdminUser"
  ADD COLUMN "kind" "AdminUserKind" NOT NULL DEFAULT 'PC',
  ADD COLUMN "isSuper" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "roleId" TEXT;

ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "AdminRoleDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AdminUser_roleId_idx" ON "AdminUser"("roleId");

-- 存量账号：门店类型 / 超级管理员
UPDATE "AdminUser" SET "kind" = 'STORE' WHERE "role" = 'STORE';
UPDATE "AdminUser" SET "isSuper" = true WHERE "role" = 'SUPER';

-- 原 OPS / CS / WMS 转为普通角色，权限由旧 @Roles 推导
INSERT INTO "AdminRoleDef" ("id", "name", "description", "permissions", "createdAt", "updatedAt") VALUES
(
  'role_ops_default',
  '商品运营',
  '由原「商品运营」角色迁移，可在角色管理中调整或删除',
  ARRAY['aftersale.view', 'analytics.view', 'asset.manage', 'asset.view', 'category.manage', 'category.view', 'coupon.edit', 'coupon.view', 'customer.edit', 'customer.view', 'dashboard.view', 'delivery.manage', 'express.manage', 'express.view', 'level.manage', 'level.view', 'log.view', 'membercard.manage', 'membercard.view', 'micropage.manage', 'micropage.view', 'miniapp.view', 'notification.manage', 'order.refund', 'order.view', 'pickup.verify', 'points.manage', 'points.view', 'popupad.manage', 'popupad.view', 'product.edit', 'product.stock', 'product.view', 'promotion.manage', 'promotion.view', 'review.manage', 'store.edit', 'store.view', 'system.view', 'tabbar.manage', 'tabbar.view', 'tag.manage', 'tag.view', 'usertag.manage', 'usertag.view', 'integration.view', 'shop.view', 'freight.manage']::text[],
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  'role_cs_default',
  '客服',
  '由原「客服」角色迁移，可在角色管理中调整或删除',
  ARRAY['aftersale.audit', 'aftersale.view', 'analytics.view', 'category.view', 'coupon.view', 'customer.edit', 'customer.view', 'dashboard.view', 'delivery.manage', 'express.view', 'level.view', 'log.view', 'membercard.view', 'order.edit', 'order.refund', 'order.view', 'pickup.verify', 'points.view', 'product.stock', 'product.view', 'promotion.view', 'review.manage', 'store.view', 'tag.view', 'usertag.view', 'asset.view', 'integration.view', 'micropage.view', 'popupad.view', 'shop.view', 'tabbar.view', 'freight.manage']::text[],
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  'role_wms_default',
  '仓储',
  '由原「仓储」角色迁移，可在角色管理中调整或删除',
  ARRAY['aftersale.audit', 'aftersale.view', 'dashboard.view', 'delivery.manage', 'express.manage', 'express.view', 'order.ship', 'order.view', 'pickup.verify', 'product.stock', 'product.view', 'store.view', 'asset.view', 'integration.view', 'shop.view', 'freight.manage']::text[],
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

UPDATE "AdminUser" SET "roleId" = 'role_ops_default' WHERE "role" = 'OPS';
UPDATE "AdminUser" SET "roleId" = 'role_cs_default' WHERE "role" = 'CS';
UPDATE "AdminUser" SET "roleId" = 'role_wms_default' WHERE "role" = 'WMS';

ALTER TABLE "AdminUser" DROP COLUMN "role";
DROP TYPE "AdminRole";
