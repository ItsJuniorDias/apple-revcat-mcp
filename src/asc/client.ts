import { gunzipSync } from "node:zlib";
import { getAscToken } from "./auth.js";

const BASE = "https://api.appstoreconnect.apple.com";

async function ascFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAscToken();
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

export async function ascGetJson<T = unknown>(path: string): Promise<T> {
  const res = await ascFetch(path);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ASC ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export type SalesReportParams = {
  vendorNumber: string;
  reportType: "SALES" | "SUBSCRIPTION" | "SUBSCRIPTION_EVENT" | "SUBSCRIBER" | "PRE_ORDER";
  reportSubType: "SUMMARY" | "DETAILED";
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  reportDate: string;
  version?: string;
};

/**
 * Fetches a sales/subscription report. Apple returns gzipped TSV — we unzip
 * and return the text so the model can parse it directly.
 */
export async function ascGetSalesReport(params: SalesReportParams): Promise<string> {
  const qs = new URLSearchParams({
    "filter[vendorNumber]": params.vendorNumber,
    "filter[reportType]": params.reportType,
    "filter[reportSubType]": params.reportSubType,
    "filter[frequency]": params.frequency,
    "filter[reportDate]": params.reportDate,
  });
  if (params.version) qs.set("filter[version]", params.version);

  const res = await ascFetch(`/v1/salesReports?${qs.toString()}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ASC salesReports ${res.status}: ${body.slice(0, 500)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return gunzipSync(buf).toString("utf-8");
}
