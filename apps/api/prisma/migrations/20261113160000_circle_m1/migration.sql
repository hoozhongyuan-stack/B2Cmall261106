-- CreateEnum
CREATE TYPE "CirclePostStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "CircleReportStatus" AS ENUM ('PENDING', 'RESOLVED', 'REJECTED');

-- AlterTable
ALTER TABLE "AdminRoleDef" ALTER COLUMN "permissions" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PointsConfig" ALTER COLUMN "id" SET DEFAULT 'singleton';

-- CreateTable
CREATE TABLE "CircleCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iconKey" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CircleCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CircleTopic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "coverKey" TEXT,
    "categoryId" TEXT,
    "startAt" TIMESTAMPTZ(3),
    "endAt" TIMESTAMPTZ(3),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CircleTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CirclePost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mediaJson" JSONB NOT NULL,
    "status" "CirclePostStatus" NOT NULL DEFAULT 'PUBLISHED',
    "auditNote" TEXT,
    "auditedBy" TEXT,
    "auditedAt" TIMESTAMPTZ(3),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "favoriteCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CirclePost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CirclePostTopic" (
    "postId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CirclePostTopic_pkey" PRIMARY KEY ("postId","topicId")
);

-- CreateTable
CREATE TABLE "CirclePostProduct" (
    "postId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CirclePostProduct_pkey" PRIMARY KEY ("postId","productId")
);

-- CreateTable
CREATE TABLE "CircleComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentId" TEXT,
    "content" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CircleComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CircleLike" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CircleLike_pkey" PRIMARY KEY ("postId","userId")
);

-- CreateTable
CREATE TABLE "CircleFavorite" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CircleFavorite_pkey" PRIMARY KEY ("postId","userId")
);

-- CreateTable
CREATE TABLE "CircleFollow" (
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CircleFollow_pkey" PRIMARY KEY ("followerId","followingId")
);

-- CreateTable
CREATE TABLE "CircleReport" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "status" "CircleReportStatus" NOT NULL DEFAULT 'PENDING',
    "handledBy" TEXT,
    "handledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CircleReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CircleNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "postId" TEXT,
    "commentId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CircleNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CircleSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "auditMode" TEXT NOT NULL DEFAULT 'HYBRID',
    "dailyPostLimit" INTEGER NOT NULL DEFAULT 5,
    "dailyCommentLimit" INTEGER NOT NULL DEFAULT 30,
    "postPoints" INTEGER NOT NULL DEFAULT 10,
    "postPointsDailyLimit" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CircleSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CircleCategory_enabled_sort_idx" ON "CircleCategory"("enabled", "sort");

-- CreateIndex
CREATE INDEX "CircleTopic_enabled_pinned_sort_idx" ON "CircleTopic"("enabled", "pinned", "sort");

-- CreateIndex
CREATE INDEX "CircleTopic_categoryId_idx" ON "CircleTopic"("categoryId");

-- CreateIndex
CREATE INDEX "CirclePost_status_publishedAt_idx" ON "CirclePost"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "CirclePost_categoryId_status_publishedAt_idx" ON "CirclePost"("categoryId", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "CirclePost_userId_createdAt_idx" ON "CirclePost"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CirclePostTopic_topicId_idx" ON "CirclePostTopic"("topicId");

-- CreateIndex
CREATE INDEX "CirclePostProduct_productId_idx" ON "CirclePostProduct"("productId");

-- CreateIndex
CREATE INDEX "CircleComment_postId_createdAt_idx" ON "CircleComment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "CircleComment_userId_idx" ON "CircleComment"("userId");

-- CreateIndex
CREATE INDEX "CircleLike_userId_idx" ON "CircleLike"("userId");

-- CreateIndex
CREATE INDEX "CircleFavorite_userId_idx" ON "CircleFavorite"("userId");

-- CreateIndex
CREATE INDEX "CircleFollow_followingId_idx" ON "CircleFollow"("followingId");

-- CreateIndex
CREATE INDEX "CircleReport_status_createdAt_idx" ON "CircleReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CircleReport_targetType_targetId_idx" ON "CircleReport"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "CircleNotification_userId_read_createdAt_idx" ON "CircleNotification"("userId", "read", "createdAt");

-- AddForeignKey
ALTER TABLE "CircleTopic" ADD CONSTRAINT "CircleTopic_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CircleCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CirclePost" ADD CONSTRAINT "CirclePost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CirclePost" ADD CONSTRAINT "CirclePost_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CircleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CirclePostTopic" ADD CONSTRAINT "CirclePostTopic_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CirclePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CirclePostTopic" ADD CONSTRAINT "CirclePostTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "CircleTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CirclePostProduct" ADD CONSTRAINT "CirclePostProduct_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CirclePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CirclePostProduct" ADD CONSTRAINT "CirclePostProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleComment" ADD CONSTRAINT "CircleComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CirclePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleComment" ADD CONSTRAINT "CircleComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleLike" ADD CONSTRAINT "CircleLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CirclePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleLike" ADD CONSTRAINT "CircleLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleFavorite" ADD CONSTRAINT "CircleFavorite_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CirclePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleFavorite" ADD CONSTRAINT "CircleFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleFollow" ADD CONSTRAINT "CircleFollow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleFollow" ADD CONSTRAINT "CircleFollow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleReport" ADD CONSTRAINT "CircleReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleNotification" ADD CONSTRAINT "CircleNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleNotification" ADD CONSTRAINT "CircleNotification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 圈子默认设置（单例）
INSERT INTO "CircleSetting" ("id", "updatedAt") VALUES ('singleton', NOW())
ON CONFLICT ("id") DO NOTHING;

-- 默认类目：上线即可发帖，运营可随时改名或停用
INSERT INTO "CircleCategory" ("id", "name", "sort", "enabled", "updatedAt") VALUES
    ('circle_cat_recipe', '山野食谱', 10, true, NOW()),
    ('circle_cat_drink', '茶与咖啡', 20, true, NOW()),
    ('circle_cat_object', '器物日常', 30, true, NOW()),
    ('circle_cat_outdoor', '露营户外', 40, true, NOW()),
    ('circle_cat_ugc', '买家秀', 50, true, NOW())
ON CONFLICT ("id") DO NOTHING;

-- 默认话题：供首页横滑与发布页选择
INSERT INTO "CircleTopic" ("id", "name", "description", "categoryId", "pinned", "enabled", "sort", "postCount", "updatedAt") VALUES
    ('circle_topic_tea', '秋日第一杯茶', '晒出你的秋日茶席与冲泡心得', 'circle_cat_drink', true, true, 10, 0, NOW()),
    ('circle_topic_camp', '周末去露营', '山野露营装备与营地分享', 'circle_cat_outdoor', false, true, 20, 0, NOW()),
    ('circle_topic_desk', '桌面一角', '器物与桌面布置灵感', 'circle_cat_object', false, true, 30, 0, NOW())
ON CONFLICT ("id") DO NOTHING;

-- 权限：具备营销管理能力的角色获得圈子完整权限
UPDATE "AdminRoleDef"
SET "permissions" = array_append(
        array_append(
            array_append("permissions", 'circle.view'),
            'circle.audit'
        ),
        'circle.manage'
    ),
    "updatedAt" = NOW()
WHERE 'promotion.manage' = ANY("permissions")
  AND NOT ('circle.manage' = ANY("permissions"));

-- 权限：仅具备营销查看能力的角色获得圈子查看
UPDATE "AdminRoleDef"
SET "permissions" = array_append("permissions", 'circle.view'),
    "updatedAt" = NOW()
WHERE 'promotion.view' = ANY("permissions")
  AND NOT ('circle.view' = ANY("permissions"));

-- 权限：客服角色补充内容审核（举报处理）
UPDATE "AdminRoleDef"
SET "permissions" = array_append("permissions", 'circle.audit'),
    "updatedAt" = NOW()
WHERE 'customer.edit' = ANY("permissions")
  AND NOT ('circle.audit' = ANY("permissions"));
