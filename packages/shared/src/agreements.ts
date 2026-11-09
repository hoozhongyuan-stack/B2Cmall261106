/** 小程序协议版本：正文在小程序静态页维护，前后端共用同一版本号 */
export const AGREEMENT_VERSIONS = {
  terms: '2026-11-01',
  privacy: '2026-11-01',
} as const;

export type AgreementType = 'terms' | 'privacy';

/** 服务端留痕用的类型编码 */
export const AGREEMENT_CONSENT_TYPE: Record<AgreementType, string> = {
  terms: 'USER_AGREEMENT',
  privacy: 'PRIVACY',
};

export const AGREEMENT_TITLES: Record<AgreementType, string> = {
  terms: '用户协议',
  privacy: '隐私政策',
};
