/**
 * Minimal typings for RevenueCat REST v2. We keep response shapes loose
 * (index signatures for extras) because RevenueCat evolves the schema without
 * changing the endpoint version.
 */

export type RcListResponse<T> = {
  items: T[];
  next_page?: string | null;
  object?: string;
  url?: string;
};

export type RcApp = {
  id: string;
  name?: string;
  type?: string; // app_store, play_store, amazon, mac_app_store, stripe, ...
  created_at?: number;
  project_id?: string;
  bundle_id?: string;
  package_name?: string;
  [key: string]: unknown;
};

export type RcProduct = {
  id: string;
  store_identifier?: string;
  type?: string;
  app_id?: string;
  display_name?: string;
  [key: string]: unknown;
};

export type RcEntitlement = {
  id: string;
  lookup_key?: string;
  display_name?: string;
  [key: string]: unknown;
};

export type RcCustomer = {
  id: string;
  project_id?: string;
  first_seen_at?: number;
  last_seen_at?: number;
  active_entitlements?: { items?: unknown[] };
  [key: string]: unknown;
};

export type RcProject = {
  id: string;
  name?: string;
  created_at?: number;
  [key: string]: unknown;
};
