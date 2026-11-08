-- CreateTable
CREATE TABLE "SearchLog" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchLog_createdAt_idx" ON "SearchLog"("createdAt");

-- CreateIndex
CREATE INDEX "SearchLog_keyword_createdAt_idx" ON "SearchLog"("keyword", "createdAt");

-- CreateIndex
CREATE INDEX "SearchLog_resultCount_createdAt_idx" ON "SearchLog"("resultCount", "createdAt");
