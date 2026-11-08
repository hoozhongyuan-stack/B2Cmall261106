-- 迭代 A：订阅消息发送日志、退款渠道对账字段、模板字段映射

-- Refund：渠道状态与最近查询时间
ALTER TABLE "Refund" ADD COLUMN "channelStatus" TEXT;
ALTER TABLE "Refund" ADD COLUMN "lastQueriedAt" TIMESTAMP(3) WITH TIME ZONE;

-- IntegrationConfig：订阅消息模板字段映射
ALTER TABLE "IntegrationConfig" ADD COLUMN "subscribeTemplateFields" JSONB;

-- 订阅消息 outbox
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "scene" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openid" TEXT,
    "page" TEXT,
    "dataJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3) WITH TIME ZONE,
    "error" TEXT,
    "responseJson" JSONB,
    "sentAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationLog_dedupeKey_key" ON "NotificationLog"("dedupeKey");
CREATE INDEX "NotificationLog_status_nextRetryAt_idx" ON "NotificationLog"("status", "nextRetryAt");
CREATE INDEX "NotificationLog_scene_createdAt_idx" ON "NotificationLog"("scene", "createdAt");
