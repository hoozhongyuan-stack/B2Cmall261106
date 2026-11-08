-- 素材库升级：本地图片上传 + 一级文件夹；历史 group 转为文件夹，default 归入未分类
CREATE TABLE "AssetFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetFolder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetFolder_name_key" ON "AssetFolder"("name");

ALTER TABLE "Asset" ADD COLUMN     "folderId" TEXT,
ADD COLUMN     "storageKey" TEXT,
ADD COLUMN     "originalName" TEXT;

-- 旧分组生成文件夹（default 视为未分类）
INSERT INTO "AssetFolder" ("id", "name", "sort", "createdAt")
SELECT 'af_' || md5("group"), "group", 0, NOW()
FROM "Asset"
WHERE "group" IS NOT NULL AND "group" <> '' AND "group" <> 'default'
GROUP BY "group";

UPDATE "Asset" a
SET "folderId" = 'af_' || md5(a."group")
FROM "AssetFolder" f
WHERE f."name" = a."group" AND a."group" <> 'default';

ALTER TABLE "Asset" DROP COLUMN "group",
DROP COLUMN "refCount";

ALTER TABLE "Asset" ADD CONSTRAINT "Asset_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "AssetFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Asset_folderId_idx" ON "Asset"("folderId");
