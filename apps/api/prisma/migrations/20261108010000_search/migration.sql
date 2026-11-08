-- 全文检索：pg_trgm 扩展 + 商品搜索文本 + GIN trigram 索引
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "Product_searchText_idx" ON "Product" USING GIN ("searchText" gin_trgm_ops);
