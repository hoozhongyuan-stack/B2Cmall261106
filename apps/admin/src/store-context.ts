const ACTIVE_STORE_KEY = 'shanye_active_store_id';
export const STORE_CHANGED_EVENT = 'shanye:store-changed';

export function getActiveStoreId(): string {
  return localStorage.getItem(ACTIVE_STORE_KEY) ?? '';
}

export function setActiveStoreId(storeId: string): void {
  if (storeId) localStorage.setItem(ACTIVE_STORE_KEY, storeId);
  else localStorage.removeItem(ACTIVE_STORE_KEY);
  window.dispatchEvent(new CustomEvent(STORE_CHANGED_EVENT, { detail: storeId }));
}
