/**
 * Minimal typings for the App Store Connect responses we actually consume.
 * Apple returns a lot more fields than we need — we only pin down the ones
 * we access, so a future field addition on Apple's side doesn't break the build.
 */

export type AscResource<TAttrs> = {
  id: string;
  type: string;
  attributes?: TAttrs;
};

export type AscListResponse<TAttrs> = {
  data: AscResource<TAttrs>[];
  links?: { self?: string; next?: string };
  meta?: { paging?: { total?: number; limit?: number } };
};

// ---- Apps ----

export type AscAppAttributes = {
  name?: string;
  bundleId?: string;
  sku?: string;
  primaryLocale?: string;
};

export type AscApp = {
  id: string;
  name?: string;
  bundleId?: string;
  sku?: string;
  primaryLocale?: string;
};

// ---- Reviews ----

export type AscCustomerReviewAttributes = {
  rating?: number;
  title?: string;
  body?: string;
  reviewerNickname?: string;
  createdDate?: string;
  territory?: string;
};

export type AscCustomerReview = {
  id: string;
  rating?: number;
  title?: string;
  body?: string;
  reviewerNickname?: string;
  createdDate?: string;
  territory?: string;
  developerResponse?: {
    id: string;
    body?: string;
    lastModifiedDate?: string;
    state?: string;
  } | null;
};

// ---- Sales report params ----

export type SalesReportType =
  | "SALES"
  | "SUBSCRIPTION"
  | "SUBSCRIPTION_EVENT"
  | "SUBSCRIBER"
  | "PRE_ORDER";

export type SalesReportSubType = "SUMMARY" | "DETAILED";

export type SalesReportFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type SalesReportParams = {
  vendorNumber: string;
  reportType: SalesReportType;
  reportSubType: SalesReportSubType;
  frequency: SalesReportFrequency;
  reportDate: string;
  version?: string;
};
