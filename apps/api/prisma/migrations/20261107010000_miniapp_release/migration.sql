-- 小程序发布记录表 + 代码上传密钥
ALTER TABLE "IntegrationConfig" ADD COLUMN "miniappUploadKeyFile" TEXT;
ALTER TABLE "IntegrationConfig" ADD COLUMN "miniappUploadKeyName" TEXT;

CREATE TABLE "MiniappRelease" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BUILDING',
    "qrCodePath" TEXT,
    "size" INTEGER NOT NULL DEFAULT 0,
    "log" TEXT,
    "operatorId" TEXT,
    "operatorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MiniappRelease_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MiniappRelease_createdAt_idx" ON "MiniappRelease"("createdAt");
