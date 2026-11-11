import type { MicroLink } from '@shanye/shared/src/microPage';

import { api } from './client';

export interface PopupAd {
  id: string;
  name: string;
  imageKey: string;
  alt: string | null;
  link: MicroLink;
  priority: number;
  enabled: boolean;
  startAt: string | null;
  endAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PopupAdInput {
  name: string;
  imageKey: string;
  alt?: string | null;
  link?: MicroLink;
  priority?: number;
  enabled?: boolean;
  startAt?: string | null;
  endAt?: string | null;
}

export interface PopupAdList {
  total: number;
  page: number;
  pageSize: number;
  items: PopupAd[];
}

export function listPopupAds(query: {
  keyword?: string;
  enabled?: boolean;
  page?: number;
  pageSize?: number;
}) {
  return api<PopupAdList>('/admin/popup-ads', { query });
}

export function createPopupAd(input: PopupAdInput) {
  return api<PopupAd>('/admin/popup-ads', { method: 'POST', body: input });
}

export function updatePopupAd(id: string, input: PopupAdInput) {
  return api<PopupAd>(`/admin/popup-ads/${id}`, { method: 'PUT', body: input });
}

export function togglePopupAd(id: string, enabled: boolean) {
  return api<PopupAd>(`/admin/popup-ads/${id}/enabled`, {
    method: 'PATCH',
    body: { enabled },
  });
}

export function deletePopupAd(id: string) {
  return api<{ deleted: boolean }>(`/admin/popup-ads/${id}`, { method: 'DELETE' });
}
