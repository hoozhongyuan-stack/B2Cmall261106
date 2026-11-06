-- 对外集成参数独立成表；小程序 AppID 从店铺配置迁移过来，避免两处维护
CREATE TABLE "IntegrationConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "miniappAppId" TEXT,
    "miniappAppSecretFile" TEXT,
    "miniappAppSecretName" TEXT,
    "paymentProvider" TEXT NOT NULL DEFAULT 'mock',
    "wechatPayMchId" TEXT,
    "wechatPayCertSerial" TEXT,
    "wechatPayNotifyUrl" TEXT,
    "wechatPayApiV3KeyFile" TEXT,
    "wechatPayApiV3KeyName" TEXT,
    "wechatPayPrivateKeyFile" TEXT,
    "wechatPayPrivateKeyName" TEXT,
    "subscribeTemplateIds" JSONB,
    "apiBaseUrl" TEXT,
    "businessDomain" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);

INSERT INTO "IntegrationConfig" ("id", "miniappAppId", "updatedAt")
SELECT 'singleton', "miniappAppId", NOW()
FROM "ShopConfig"
WHERE "id" = 'singleton' AND "miniappAppId" IS NOT NULL;

ALTER TABLE "ShopConfig" DROP COLUMN "miniappAppId";
