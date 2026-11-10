import { api, apiUpload } from './client';

export interface AssetItem {
  id: string;
  key: string;
  url: string;
  storageKey: string | null;
  originalName: string | null;
  size: number;
  mimeType: string | null;
  folderId: string | null;
  folderName: string | null;
  refCount: number;
  createdAt: string;
}

export interface AssetPage {
  total: number;
  page: number;
  pageSize: number;
  items: AssetItem[];
}

export interface AssetFolder {
  id: string;
  name: string;
  sort: number;
  count: number;
  createdAt: string;
}

export interface AssetFolderList {
  total: number;
  uncategorized: number;
  items: AssetFolder[];
}

/** 素材 key 转可预览地址：上传素材为 /api/...，历史静态素材为 /static/... */
export function assetPreviewUrl(key?: string | null): string {
  if (!key) return '';
  if (/^https?:\/\//i.test(key) || key.startsWith('/')) return key;
  return `/static/${key}`;
}

export function listAssets(query: {
  folderId?: string;
  keyword?: string;
  kind?: 'image' | 'video';
  page?: number;
  pageSize?: number;
}) {
  return api<AssetPage>('/admin/assets', { query });
}

export function listAssetFolders() {
  return api<AssetFolderList>('/admin/assets/folders');
}

export function uploadAssets(files: File[], folderId?: string | null) {
  return apiUpload<{ items: { id: string; key: string; url: string }[] }>(
    '/admin/assets/upload',
    files,
    folderId ? { folderId } : {},
  );
}

export function createAssetFolder(name: string) {
  return api<AssetFolder>('/admin/assets/folders', { method: 'POST', body: { name } });
}

export function updateAssetFolder(id: string, input: { name?: string; sort?: number }) {
  return api<AssetFolder>(`/admin/assets/folders/${id}`, { method: 'PATCH', body: input });
}

export function deleteAssetFolder(id: string) {
  return api<{ deleted: boolean }>(`/admin/assets/folders/${id}`, { method: 'DELETE' });
}

export function moveAsset(id: string, folderId: string | null) {
  return api<AssetItem>(`/admin/assets/${id}`, { method: 'PATCH', body: { folderId } });
}

export function deleteAsset(id: string) {
  return api<{ deleted: boolean }>(`/admin/assets/${id}`, { method: 'DELETE' });
}

export function batchDeleteAssets(ids: string[]) {
  return api<{ total: number; success: number; failed: number; errors?: { id: string; message: string }[] }>(
    '/admin/assets/batch/delete',
    { method: 'POST', body: { ids } },
  );
}

export function formatAssetSize(size: number): string {
  if (!size || size <= 0) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
