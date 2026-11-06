-- 小程序 AppSecret 改为后台文本录入，不再以文件形式保存
ALTER TABLE "IntegrationConfig" ADD COLUMN "miniappAppSecret" TEXT;
ALTER TABLE "IntegrationConfig" DROP COLUMN "miniappAppSecretFile";
ALTER TABLE "IntegrationConfig" DROP COLUMN "miniappAppSecretName";
