import type {
  MicroComponent,
  MicroLink,
  MicroPageSettings,
  ShopTabbarConfig,
} from '@shanye/shared/src/microPage';

import { api } from './client';

export interface MicroPageSummary {
  id: string;
  code: string;
  title: string;
  status: 'DRAFT' | 'PUBLISHED';
  isHome: boolean;
  version: number;
  componentCount: number;
  publishedComponentCount: number;
  published: boolean;
  publishedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface MicroPageDetail extends MicroPageSummary {
  components: MicroComponent[];
  settings: MicroPageSettings;
  publishedComponents: MicroComponent[];
  publishedSettings: MicroPageSettings | null;
}

export interface LinkOption {
  value: string;
  label: string;
  hint: string;
}

export interface MicroPageList {
  total: number;
  page: number;
  pageSize: number;
  items: MicroPageSummary[];
}

export function listMicroPages(query: {
  keyword?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  return api<MicroPageList>('/admin/micro-pages', { query });
}

export function getMicroPage(id: string) {
  return api<MicroPageDetail>(`/admin/micro-pages/${id}`);
}

export function createMicroPage(input: { title: string; code?: string; copyFromId?: string }) {
  return api<MicroPageDetail>('/admin/micro-pages', { method: 'POST', body: input });
}

export function saveMicroPage(
  id: string,
  input: {
    title?: string;
    components?: MicroComponent[];
    settings?: MicroPageSettings;
    expectedUpdatedAt?: string;
  },
) {
  return api<MicroPageDetail>(`/admin/micro-pages/${id}`, { method: 'PUT', body: input });
}

export function publishMicroPage(id: string) {
  return api<MicroPageDetail>(`/admin/micro-pages/${id}/publish`, { method: 'POST' });
}

export function rollbackMicroPage(id: string) {
  return api<MicroPageDetail>(`/admin/micro-pages/${id}/rollback`, { method: 'POST' });
}

export function duplicateMicroPage(id: string) {
  return api<MicroPageDetail>(`/admin/micro-pages/${id}/duplicate`, { method: 'POST' });
}

export function setMicroPageHome(id: string) {
  return api<MicroPageDetail>(`/admin/micro-pages/${id}/home`, { method: 'POST' });
}

export function removeMicroPageHome() {
  return api<{ homeRenderer: 'legacy' }>('/admin/micro-pages/home', { method: 'DELETE' });
}

export function deleteMicroPage(id: string) {
  return api<{ deleted: boolean }>(`/admin/micro-pages/${id}`, { method: 'DELETE' });
}

export function migrateLegacyHome() {
  return api<{ created: boolean }>('/admin/micro-pages/migrate-home', { method: 'POST' });
}

export function listLinkOptions(type: string, keyword?: string, limit = 30) {
  return api<{ items: LinkOption[] }>('/admin/link-options', {
    query: { type, keyword, limit },
  });
}

export function getTabbar() {
  return api<ShopTabbarConfig>('/admin/tabbar');
}

export function saveTabbar(config: ShopTabbarConfig) {
  return api<ShopTabbarConfig>('/admin/tabbar', { method: 'PUT', body: config });
}

export type { MicroComponent, MicroLink, MicroPageSettings, ShopTabbarConfig };
