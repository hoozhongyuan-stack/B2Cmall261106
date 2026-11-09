-- 用户标签体系：两级标签与用户多对多绑定

CREATE TABLE "UserTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "UserTag_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UserTag_parentId_sort_idx" ON "UserTag"("parentId", "sort");

CREATE TABLE "UserTagLink" (
    "userId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserTagLink_pkey" PRIMARY KEY ("userId", "tagId")
);
CREATE INDEX "UserTagLink_tagId_idx" ON "UserTagLink"("tagId");

ALTER TABLE "UserTag" ADD CONSTRAINT "UserTag_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "UserTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserTagLink" ADD CONSTRAINT "UserTagLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserTagLink" ADD CONSTRAINT "UserTagLink_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "UserTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
