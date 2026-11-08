import { join, resolve } from 'node:path';

/** 本地上传根目录：可用 UPLOAD_DIR 覆盖，默认 <api>/uploads */
export function uploadRoot(): string {
  return process.env.UPLOAD_DIR
    ? resolve(process.env.UPLOAD_DIR)
    : resolve(process.cwd(), 'uploads');
}

/** 素材库图片目录（磁盘） */
export function assetsDir(): string {
  return join(uploadRoot(), 'assets');
}

/** 素材图片的对外访问前缀（由 API 静态托管，Nginx /api/ 反代即可） */
export const ASSET_URL_PREFIX = '/api/media/assets/';

export function assetUrl(storageKey: string): string {
  return `${ASSET_URL_PREFIX}${storageKey}`;
}
