/** 微信支付 APIv3 运行参数（由集成配置 + 服务端密钥文件组装） */
export interface WechatPayConfig {
  /** 小程序 AppID */
  appId: string;
  mchId: string;
  /** 商户 API 证书序列号 */
  certSerial: string;
  /** 支付结果回调地址，必须是 https 公网地址 */
  notifyUrl: string;
  /** APIv3 密钥（32 位），用于回调解密 */
  apiV3Key: string;
  /** 商户 API 私钥（PEM） */
  privateKeyPem: string;
  /** 微信支付公钥 ID（公钥模式，形如 PUB_KEY_ID_...） */
  publicKeyId?: string;
  /** 微信支付公钥（PEM，公钥模式） */
  publicKeyPem?: string;
}

export interface WechatPayJsapiParams {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
}

/** 微信支付 APIv3 加密资源（回调与平台证书） */
export interface WechatPayEncryptedResource {
  algorithm: string;
  ciphertext: string;
  associated_data?: string;
  nonce: string;
  original_type?: string;
}
