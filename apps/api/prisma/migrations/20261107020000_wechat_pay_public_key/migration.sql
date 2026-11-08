-- 微信支付公钥模式：公钥 ID 与公钥文件（平台证书模式留空）
ALTER TABLE "IntegrationConfig" ADD COLUMN     "wechatPayPublicKeyId" TEXT,
ADD COLUMN     "wechatPayPublicKeyFile" TEXT,
ADD COLUMN     "wechatPayPublicKeyName" TEXT;
