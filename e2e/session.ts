import type { Page } from '@playwright/test';
import { AGREEMENT_VERSIONS } from '../packages/shared/src/agreements';

/** 接口登录时随请求提交的协议同意参数 */
export const CONSENT = {
  agreed: true,
  agreementVersion: AGREEMENT_VERSIONS.terms,
  privacyVersion: AGREEMENT_VERSIONS.privacy,
};

/** 小程序本地缓存的协议版本（Taro storage 结构为 { data }） */
const STORAGE_CONSENT = {
  terms: AGREEMENT_VERSIONS.terms,
  privacy: AGREEMENT_VERSIONS.privacy,
};

/** 把接口拿到的 token 与协议同意状态写入浏览器，跳过登录页 */
export async function injectSession(page: Page, token: string): Promise<void> {
  await page.addInitScript(
    ({ token: value, consent }) => {
      localStorage.setItem('shanye_token', JSON.stringify({ data: value }));
      localStorage.setItem('shanye_consent', JSON.stringify({ data: consent }));
    },
    { token, consent: STORAGE_CONSENT },
  );
}
